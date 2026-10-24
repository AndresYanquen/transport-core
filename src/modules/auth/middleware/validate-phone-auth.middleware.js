const { normalizePhoneNumber } = require("../utils/phone");
const { validateContext, installationMetadata } = require("../utils/phone-auth-context");

function badRequest(res, message) { return res.status(400).json({ message }); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function requestOtp(req, res, next) {
  try { validateContext(req.body || {}, true); }
  catch (error) { return badRequest(res, error.message); }
  const { phoneNumber, accountType = "client" } = req.body || {};
  if (typeof phoneNumber !== "string" || phoneNumber.length > 64 || !phoneNumber.trim()) {
    return badRequest(res, "phoneNumber is required and must be a string.");
  }
  if (!["client", "driver"].includes(accountType)) return badRequest(res, "accountType must be client or driver.");
  try { req.phoneAuthPayload = { phoneNumber: normalizePhoneNumber(phoneNumber), accountType,
    deviceId: req.body.deviceId, requestId: req.body.requestId }; }
  catch { return badRequest(res, "phoneNumber must be a valid phone number."); }
  next();
}

function verifyOtp(req, res, next) {
  try { installationMetadata(req.body?.deviceId, req.body?.device); }
  catch (error) { return badRequest(res, error.message); }
  const { challengeId, code, registration = {}, rememberMe = true } = req.body || {};
  if (typeof challengeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)) {
    return badRequest(res, "challengeId must be a valid challenge UUID.");
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return badRequest(res, "code must contain exactly 6 digits.");
  if (typeof rememberMe !== "boolean") return badRequest(res, "rememberMe must be a boolean.");
  if (!object(registration)) return badRequest(res, "registration must be an object.");
  for (const key of ["firstName", "lastName"]) {
    if (registration[key] !== undefined && (typeof registration[key] !== "string" || registration[key].length > 100)) {
      return badRequest(res, `${key} must be a string of at most 100 characters.`);
    }
  }
  let driverProfile;
  if (registration.driverProfile !== undefined) {
    if (!object(registration.driverProfile)) return badRequest(res, "driverProfile must be an object.");
    driverProfile = {};
    for (const key of ["licenseNumber", "vehicleMake", "vehicleModel", "vehiclePlate"]) {
      const value = registration.driverProfile[key];
      if (typeof value !== "string" || !value.trim() || value.length > 50) {
        return badRequest(res, `driverProfile.${key} is required and must have at most 50 characters.`);
      }
      driverProfile[key] = value.trim();
    }
  }
  // Only explicitly supported registration fields enter the service.
  req.phoneAuthPayload = { challengeId, code, rememberMe, deviceId: req.body.deviceId, device: req.body.device, registration: {
    firstName: registration.firstName?.trim(), lastName: registration.lastName?.trim(), driverProfile,
  } };
  next();
}

module.exports = { requestOtp, verifyOtp };
