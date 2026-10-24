const Model = require("../models/mobile-session.model");

function assertAdditionalFactorPolicy(user) {
  // No client boolean or device metadata constitutes second-factor evidence.
  // Passkey verification will provide server-validated evidence in its own stage.
  if (["client", "driver"].includes(user.role) && user.mobile_additional_factor_required) {
    throw Object.assign(new Error("Additional authentication factor required."), {
      status: 403, code: "ADDITIONAL_FACTOR_REQUIRED",
    });
  }
}

async function assertActive(sessionId, userId) {
  const session = await Model.findActive(sessionId, userId);
  if (!session) throw Object.assign(new Error("Mobile session is invalid or expired. Authenticate again with OTP."), { status: 401 });
  return session;
}

function requireOtp() {
  return Object.assign(new Error("Authenticate with OTP to create a mobile installation session."), { status: 401, code: "OTP_REQUIRED" });
}

function assertAccessContext(user, payload, path = "") {
  if (!["client", "driver"].includes(user.role) || payload.sid) return;
  // Google/email may bootstrap phone enrollment; never grant full app access by
  // omitting a deviceId or choosing the legacy login endpoint.
  const enrollmentPaths = ["/api/auth/phone/link/request-otp", "/api/auth/phone/link/verify-otp", "/api/auth/me", "/api/auth/logout-all"];
  if (user.phone_verified || !enrollmentPaths.includes(path)) throw requireOtp();
}

module.exports = { assertAdditionalFactorPolicy, assertActive, assertAccessContext, requireOtp };
