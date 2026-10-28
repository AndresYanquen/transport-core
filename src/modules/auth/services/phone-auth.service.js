const crypto = require("crypto");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const { env } = require("../../../config");
const { normalizePhoneNumber } = require("../utils/phone");
const AuthModel = require("../models/auth.model");
const OtpModel = require("../models/phone-otp.model");
const AuthService = require("./auth.service");
const SmsService = require("./otp-sms.service");
const { validateContext, ipGroup, installationMetadata } = require("../utils/phone-auth-context");
const { notifyRevoked } = require("./mobile-session-events");

function digest(value) {
  return crypto.createHmac("sha256", env.phoneAuth.hashSecret).update(value).digest("hex");
}

function phoneKeyFor(phone) { return digest(`phone:${phone}`); }

function hashCode(id, phone, accountType, code, purpose = "auth", targetUserId = null) {
  return digest(`phone-otp:${purpose}:${targetUserId || ""}:${id}:${phone}:${accountType}:${code}`);
}

function linkContext(metadata) {
  if (!metadata.linkUser) return { purpose: "auth", targetUserId: null };
  if (!["client", "driver"].includes(metadata.linkUser.role) || metadata.linkUser.status !== "active") {
    throw Object.assign(new Error("Phone linking is available for mobile accounts only."), { status: 403 });
  }
  return { purpose: metadata.changePhone ? "change" : "link", targetUserId: metadata.linkUser.id };
}

async function requestOtp({ phoneNumber, accountType = "client", deviceId, requestId }, metadata = {}) {
  SmsService.assertConfigured();
  validateContext({ deviceId, requestId }, true);
  const context = linkContext(metadata);
  if (context.purpose === "change" && !metadata.credentialVersion) throw Object.assign(new Error("Identity confirmation required."), { status: 401 });
  if (context.purpose !== "auth") accountType = metadata.linkUser.role;
  // Service-level validation also protects internal callers.
  if (!["client", "driver"].includes(accountType)) {
    const error = new Error("accountType must be client or driver.");
    error.status = 400;
    throw error;
  }
  const phone = normalizePhoneNumber(phoneNumber);
  const parsed = phone ? parsePhoneNumberFromString(phone) : null;
  if (!parsed || !env.phoneAuth.allowedCountries.includes(parsed.country) ||
      (parsed.country === "CO" && !/^3\d{9}$/.test(parsed.nationalNumber))) {
    const error = new Error("Phone number is invalid or its country is not enabled.");
    error.status = 400;
    throw error;
  }
  if (context.purpose === "link" && metadata.linkUser.phoneVerified && metadata.linkUser.phoneNumber !== phone) {
    throw Object.assign(new Error("A verified phone number requires the protected change-number flow."), { status: 400 });
  }
  SmsService.assertRolloutAllowed(phone);
  const challengeId = crypto.randomUUID();
  const startedAt = Date.now();
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  const reservation = await OtpModel.reserve({ challengeId, requestId, phoneNumber: phone, accountType, ...context,
    credentialVersion: metadata.credentialVersion || null,
    codeHash: hashCode(challengeId, phone, accountType, code, context.purpose, context.targetUserId),
    phoneKey: phoneKeyFor(phone), deviceKey: digest(`device:${deviceId.toLowerCase()}`),
    ipKey: digest(`ip:${ipGroup(metadata.ip)}`), config: env.phoneAuth });
  if (!reservation.dispatch) {
    if (["failed", "unknown"].includes(reservation.status) || reservation.expiresIn <= 0) {
      throw Object.assign(new Error("Unable to send verification code. Please try again later."), { status: 503 });
    }
    return { challengeId: reservation.challengeId, expiresIn: reservation.expiresIn,
      retryAfter: env.phoneAuth.resendSeconds, deliveryStatus: reservation.status };
  }
  let delivery;
  try {
    delivery = await SmsService.sendOtp({ phoneNumber: phone, code });
  } catch (error) {
    await OtpModel.markDelivery(challengeId, false, { unknown: error.deliveryUnknown === true,
      blockProvider: error.blockProvider === true });
    throw error;
  }
  await OtpModel.markDelivery(challengeId, true, { providerReference: delivery?.providerReference });
  return { challengeId, expiresIn: Math.max(0, reservation.expiresIn - Math.ceil((Date.now() - startedAt) / 1000)),
    retryAfter: env.phoneAuth.resendSeconds, deliveryStatus: "sent" };
}

async function verifyOtp({ challengeId, code, registration = {}, rememberMe = true, deviceId, device }, metadata = {}) {
  SmsService.assertConfigured();
  validateContext({ deviceId });
  const installation = installationMetadata(deviceId, device);
  const context = linkContext(metadata);
  let replacedSessionIds = [];
  const onMobileSessionCreated = (session) => { replacedSessionIds.push(...(session.replacedSessionIds || [])); };
  const result = await OtpModel.verify({ challengeId, config: env.phoneAuth, ...context,
    deviceKey: digest(`device:${deviceId.toLowerCase()}`), ipKey: digest(`ip:${ipGroup(metadata.ip)}`), phoneKeyFor,
    codeMatches: (challenge) => {
      const candidate = hashCode(challenge.challenge_id, challenge.phone_number, challenge.account_type, code,
        challenge.purpose, challenge.target_user_id);
      const stored = Buffer.from(challenge.code_hash, "hex");
      return stored.length === 32 && crypto.timingSafeEqual(Buffer.from(candidate, "hex"), stored);
    },
    complete: async (challenge, transaction) => {
      // No admin/operator lookup, role switching or registration profile updates on login.
      let user = await AuthModel.findMobileAccountByPhoneNumber(challenge.phone_number, null, transaction);
      let isNewUser = false;
      if (context.purpose !== "auth") {
        if (user && user.id !== context.targetUserId) return null;
        const locked = await transaction.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [context.targetUserId]);
        if (context.purpose === "change" && (!locked.rows[0] || challenge.credential_version !== require("./identity-change.service").version(locked.rows[0]))) return null;
        // Link initially or apply the protected, credential-bound change; never merge accounts.
        const linked = await transaction.query(`UPDATE users SET phone_number = $2, phone_verified = true,
          phone_verification_token = NULL, phone_verification_sent_at = NULL
          WHERE id = $1 AND role = $3 AND status = 'active' AND deleted_at IS NULL
            AND ($4::boolean OR phone_number IS NULL OR phone_verified = false OR phone_number = $2) RETURNING id`,
        [context.targetUserId, challenge.phone_number, challenge.account_type, context.purpose === "change"]);
        if (!linked.rows[0]) return null;
        if (context.purpose === "change") {
          const Identity = require("./identity-change.service");
          const Model = require("../../users/models/user.model");
          const revoked = await Identity.revoke(transaction, context.targetUserId, "phone_changed");
          replacedSessionIds.push(...revoked);
          await Model.audit(transaction, context.targetUserId, context.targetUserId, "phone_changed", ["phoneNumber"]);
        }
        const linkedUser = await AuthModel.findById(context.targetUserId, transaction);
        const session = await AuthService.buildLoginSession(linkedUser, { rememberMe, metadata, transaction, mobileInstallation: installation, onMobileSessionCreated });
        return { ...session, isNewUser: false };
      }
      if (user && (user.role !== challenge.account_type || user.status !== "active")) return null;
      // An unverified contact field must not become a login factor on a credential-bearing account.
      if (user && !user.phone_verified && (user.email || user.password_hash)) return null;
      if (!user) {
        const created = await AuthService.preparePhoneAccount({
          phoneNumber: challenge.phone_number, accountType: challenge.account_type,
          firstName: registration.firstName, lastName: registration.lastName,
          driverProfile: registration.driverProfile,
        }, transaction);
        user = await AuthModel.findById(created.user.id, transaction);
        isNewUser = true;
      }
      const verified = await transaction.query(`UPDATE users SET phone_verified = true,
        phone_verification_token = NULL, phone_verification_sent_at = NULL
        WHERE id = $1 AND role IN ('client', 'driver') AND status = 'active'
          AND phone_number = $2 AND deleted_at IS NULL RETURNING id`, [user.id, challenge.phone_number]);
      if (!verified.rows[0]) return null;
      user = await AuthModel.findById(user.id, transaction);
      const session = await AuthService.buildLoginSession(user, { rememberMe, metadata, transaction, mobileInstallation: installation, onMobileSessionCreated });
      return { ...session, isNewUser };
    },
  });
  if (!result) {
    const error = new Error("Invalid or expired verification code.");
    error.status = 401;
    throw error;
  }
  // The OTP/account/session transaction has committed; only now disconnect old sockets.
  notifyRevoked(replacedSessionIds);
  return result;
}

module.exports = { requestOtp, verifyOtp };
