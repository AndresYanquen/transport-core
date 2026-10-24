const { ipKeyGenerator } = require("express-rate-limit");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateContext({ deviceId, requestId }, requesting = false) {
  if (typeof deviceId !== "string" || !uuidPattern.test(deviceId) ||
      (requesting && (typeof requestId !== "string" || !uuidPattern.test(requestId)))) {
    throw Object.assign(new Error("A valid deviceId and requestId are required for SMS requests; deviceId is required for verification."), { status: 400 });
  }
}

// Group IPv6 addresses to prevent bypass by rotating interface addresses.
function ipGroup(ip) { return ipKeyGenerator(ip || "unknown", 64); }

function installationMetadata(deviceId, device = {}) {
  validateContext({ deviceId });
  if (!device || typeof device !== "object" || Array.isArray(device)) {
    throw Object.assign(new Error("device must be an object."), { status: 400 });
  }
  const result = { deviceId: deviceId.toLowerCase() };
  for (const [key, limit] of [["name", 100], ["platform", 16], ["appVersion", 50], ["osVersion", 50]]) {
    if (device[key] !== undefined && (typeof device[key] !== "string" || device[key].length > limit)) {
      throw Object.assign(new Error(`device.${key} must be a string of at most ${limit} characters.`), { status: 400 });
    }
    result[key] = device[key]?.trim() || null;
  }
  if (result.platform && !["android", "ios"].includes(result.platform)) {
    throw Object.assign(new Error("device.platform must be android or ios."), { status: 400 });
  }
  return result;
}

module.exports = { validateContext, ipGroup, installationMetadata };
