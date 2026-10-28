const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { env } = require("../../../config");
const AuthModel = require("../models/auth.model");
const Email = require("../../email/services/email.service");
const Model = require("../../users/models/user.model");
const { keys, text } = require("../../users/middleware/user.middleware");
const { notifyRevoked } = require("./mobile-session-events");
const hash = (value) => crypto.createHmac("sha256", env.security.jwtSecret).update(value).digest("hex");
const version = (row) => hash(JSON.stringify([row.email, row.phone_number, row.password_hash, row.security_version || 0]));
const error = (status, message) => Object.assign(new Error(message), { status });
function credentials(body) {
  for (const key of ["currentPassword", "reauthToken"]) if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > 256)) throw error(400, `Invalid ${key}.`);
}
async function lockUser(db, id) {
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
  if (!rows[0] || rows[0].status !== "active") throw error(403, "User account is not active.");
  return rows[0];
}
async function assertProof(db, row, body, auth) {
  credentials(body);
  if (body.currentPassword && row.password_hash && await bcrypt.compare(body.currentPassword, row.password_hash)) return;
  if (auth?.payload?.sid && row.phone_verified) {
    const recent = await db.query(`SELECT id FROM auth_mobile_sessions WHERE id = $1 AND user_id = $2
      AND auth_method = 'sms_otp' AND revoked_at IS NULL AND expires_at > clock_timestamp()
      AND absolute_expires_at > clock_timestamp() AND created_at > clock_timestamp() - INTERVAL '5 minutes'`, [auth.payload.sid, row.id]);
    if (recent.rows.length) return;
  }
  if (body.reauthToken) {
    const used = await db.query(`UPDATE auth_identity_challenges SET used_at = clock_timestamp()
      WHERE user_id = $1 AND purpose = 'proof' AND token_hash = $2 AND credential_version = $3
      AND used_at IS NULL AND expires_at > clock_timestamp() RETURNING id`, [row.id, hash(body.reauthToken), version(row)]);
    if (used.rows.length) return;
  }
  throw error(401, "Confirm your identity using your current password, a recent OTP login, or a verified email code.");
}
async function throttle(db, id, purpose) {
  const count = await db.query(`SELECT COUNT(*)::integer AS count FROM auth_identity_challenges
    WHERE user_id = $1 AND purpose = $2 AND created_at > clock_timestamp() - INTERVAL '15 minutes'`, [id, purpose]);
  if (count.rows[0].count >= 5) throw error(429, "Too many verification requests. Try again later.");
}
async function createChallenge(db, row, purpose, target, token, seconds = 600) {
  await db.query("UPDATE auth_identity_challenges SET used_at = clock_timestamp() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [row.id, purpose]);
  const id = crypto.randomUUID();
  await db.query(`INSERT INTO auth_identity_challenges (id, user_id, purpose, target, token_hash, credential_version, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + $7 * INTERVAL '1 second')`, [id, row.id, purpose, target, hash(token), version(row), seconds]);
  return id;
}
async function sendCode(to, code) {
  if (!Email.isMailConfigured()) throw error(503, "Email verification is not configured.");
  try { await Email.sendIdentityCodeEmail({ to, code }); }
  catch { throw error(503, "Unable to send verification email. Try again later."); }
}
async function requestEmailProof(user, body = {}) {
  keys(body, []);
  // Delivery inside the transaction ensures a failed provider call rolls back the challenge.
  return Model.transaction(async (db) => {
    const row = await lockUser(db, user.id);
    if (!row.email || !row.email_verified) throw error(400, "No verified email is available. Sign in again with OTP.");
    await throttle(db, row.id, "reauth");
    const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const challengeId = await createChallenge(db, row, "reauth", row.email, code);
    await sendCode(row.email, code);
    return { challengeId, expiresIn: 600 };
  });
}
async function consumeChallenge(db, row, body, purpose) {
  if (typeof body.challengeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.challengeId) || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw error(400, "A valid challengeId and six-digit code are required.");
  const result = await db.query(`SELECT * FROM auth_identity_challenges WHERE id = $1 AND user_id = $2 AND purpose = $3 FOR UPDATE`, [body.challengeId, row.id, purpose]);
  const challenge = result.rows[0];
  const valid = challenge && await db.query("SELECT used_at IS NULL AND attempts < 5 AND expires_at > clock_timestamp() AS valid FROM auth_identity_challenges WHERE id = $1", [challenge.id]);
  if (!valid?.rows[0]?.valid || challenge.credential_version !== version(row)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(challenge.token_hash, "hex"), Buffer.from(hash(body.code), "hex"))) {
    await db.query("UPDATE auth_identity_challenges SET attempts = attempts + 1 WHERE id = $1", [challenge.id]);
    return null; // Commit failed attempts before returning an error to the caller.
  }
  await db.query("UPDATE auth_identity_challenges SET used_at = clock_timestamp() WHERE id = $1", [challenge.id]);
  return challenge;
}
async function verifyEmailProof(user, body) {
  keys(body, ["challengeId", "code"]);
  const result = await Model.transaction(async (db) => {
    const row = await lockUser(db, user.id);
    if (!await consumeChallenge(db, row, body, "reauth")) return null;
    const reauthToken = crypto.randomBytes(32).toString("hex");
    await createChallenge(db, row, "proof", row.email, reauthToken, 300);
    return { reauthToken, expiresIn: 300 };
  });
  if (!result) throw error(401, "Invalid or expired verification code.");
  return result;
}
async function requestEmailChange(user, body, auth) {
  keys(body, ["email", "currentPassword", "reauthToken"]);
  const email = text(body.email, "email", 255, false).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw error(400, "Invalid email.");
  return Model.transaction(async (db) => {
    const row = await lockUser(db, user.id);
    await assertProof(db, row, body, auth);
    await throttle(db, row.id, "email_change");
    const duplicate = await db.query("SELECT id FROM users WHERE lower(email) = $1 AND id <> $2 AND deleted_at IS NULL", [email, row.id]);
    if (duplicate.rows.length) throw error(409, "Email is already in use.");
    const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const challengeId = await createChallenge(db, row, "email_change", email, code);
    await sendCode(email, code);
    return { challengeId, expiresIn: 600 };
  });
}
async function revoke(db, id, reason) {
  const sessions = await db.query(`UPDATE auth_mobile_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
    revoked_reason = COALESCE(revoked_reason, $2) WHERE user_id = $1 RETURNING id`, [id, reason]);
  await db.query(`UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoked_reason = COALESCE(revoked_reason, $2) WHERE user_id = $1`, [id, reason]);
  await db.query("UPDATE users SET security_version = security_version + 1 WHERE id = $1", [id]);
  await db.query("UPDATE password_reset_tokens SET used_at = clock_timestamp() WHERE user_id = $1 AND used_at IS NULL", [id]);
  await db.query("UPDATE auth_identity_challenges SET used_at = clock_timestamp() WHERE user_id = $1 AND used_at IS NULL", [id]);
  return sessions.rows.map((s) => s.id);
}
async function verifyEmailChange(user, body) {
  keys(body, ["challengeId", "code"]);
  try {
    const result = await Model.transaction(async (db) => {
      const row = await lockUser(db, user.id);
      const challenge = await consumeChallenge(db, row, body, "email_change");
      if (!challenge) return null;
      await db.query(`UPDATE users SET email = $2, email_verified = true, email_verification_token = NULL, email_verification_sent_at = NULL WHERE id = $1`, [row.id, challenge.target]);
      const sessions = await revoke(db, row.id, "email_changed");
      await Model.audit(db, row.id, row.id, "email_changed", ["email"]);
      return { user: AuthModel.toPublicUser(await AuthModel.findById(row.id, db)), sessions };
    });
    if (!result) throw error(401, "Invalid or expired verification code.");
    notifyRevoked(result.sessions);
    return { user: result.user, requiresLogin: true };
  } catch (err) { if (err.code === "23505") throw error(409, "Email is already in use."); throw err; }
}
async function changePassword(user, body, auth) {
  keys(body, ["password", "currentPassword", "reauthToken"]);
  if (typeof body.password !== "string" || body.password.length < 6 || Buffer.byteLength(body.password) > 72) throw error(400, "Password must have at least 6 characters and at most 72 bytes.");
  const sessions = await Model.transaction(async (db) => {
    const row = await lockUser(db, user.id);
    await assertProof(db, row, body, auth);
    await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [row.id, await bcrypt.hash(body.password, 12)]);
    const sessions = await revoke(db, row.id, "password_changed");
    await Model.audit(db, row.id, row.id, "password_changed", ["password"]);
    return sessions;
  });
  notifyRevoked(sessions);
  return { success: true, requiresLogin: true };
}
async function authorizePhoneChange(user, body, auth) {
  return Model.transaction(async (db) => { const row = await lockUser(db, user.id); await assertProof(db, row, body, auth); return version(row); });
}
module.exports = { requestEmailProof, verifyEmailProof, requestEmailChange, verifyEmailChange, changePassword, authorizePhoneChange, revoke, hash, version };
