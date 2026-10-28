const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const driverFields = { licenseNumber: [100, false], vehicleMake: [100, false], vehicleModel: [100, false], vehiclePlate: [50, false], vehicleColor: [50, true], vehicleType: [50, true] };
function fail(message) { throw Object.assign(new Error(message), { status: 400 }); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, allowed) {
  if (!object(value)) fail("Expected a JSON object.");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Field ${key} is not editable here.`);
}
function text(value, name, max, nullable = true) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`${name} must be a non-empty string of at most ${max} characters${nullable ? " or null" : ""}.`);
  return value.trim();
}
function normalizePatch(body, role) {
  keys(body, ["firstName", "lastName", "clientProfile", "driverProfile"]);
  const patch = {};
  for (const field of ["firstName", "lastName"]) if (Object.hasOwn(body, field)) patch[field] = text(body[field], field, 100);
  if (Object.hasOwn(body, "clientProfile")) {
    if (role !== "client") fail("clientProfile is only available for passengers.");
    keys(body.clientProfile, ["defaultPaymentMethod", "homeLocation"]);
    const p = {};
    if (Object.hasOwn(body.clientProfile, "defaultPaymentMethod")) {
      // This stores a preference, never payment credentials or a payment authorization.
      p.defaultPaymentMethod = text(body.clientProfile.defaultPaymentMethod, "defaultPaymentMethod", 100);
    }
    if (Object.hasOwn(body.clientProfile, "homeLocation")) {
      const point = body.clientProfile.homeLocation;
      if (point === null) p.homeLocation = null;
      else {
        keys(point, ["lat", "lng"]);
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) fail("homeLocation must contain valid numeric lat/lng.");
        p.homeLocation = { lat: point.lat, lng: point.lng };
      }
    }
    if (!Object.keys(p).length) fail("clientProfile cannot be empty.");
    patch.clientProfile = p;
  }
  if (Object.hasOwn(body, "driverProfile")) {
    if (role !== "driver") fail("driverProfile is only available for drivers.");
    keys(body.driverProfile, [...Object.keys(driverFields), "vehicleYear", "documents"]);
    const p = {};
    for (const [field, [max, nullable]] of Object.entries(driverFields)) if (Object.hasOwn(body.driverProfile, field)) p[field] = text(body.driverProfile[field], field, max, nullable);
    if (Object.hasOwn(body.driverProfile, "vehicleYear")) {
      const year = body.driverProfile.vehicleYear;
      if (year !== null && (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear() + 1)) fail("vehicleYear must be a valid integer year or null.");
      p.vehicleYear = year;
    }
    if (Object.hasOwn(body.driverProfile, "documents")) {
      const documents = body.driverProfile.documents;
      keys(documents, ["licenseFront", "licenseBack", "vehicleRegistration", "insurance"]);
      if (!Object.keys(documents).length) fail("documents cannot be empty.");
      p.documents = {};
      for (const [key, value] of Object.entries(documents)) {
        if (value === null) { p.documents[key] = null; continue; }
        const reference = text(value, key, 2048, false);
        let url;
        try { url = new URL(reference); } catch { fail(`${key} must be an HTTPS document URL.`); }
        if (url.protocol !== "https:" || url.username || url.password) fail(`${key} must be an HTTPS document URL without credentials.`);
        p.documents[key] = reference;
      }
    }
    if (!Object.keys(p).length) fail("driverProfile cannot be empty.");
    patch.driverProfile = p;
  }
  if (!Object.keys(patch).length) fail("At least one editable field is required.");
  return patch;
}
function validateUserId(req, res, next) {
  if (!UUID.test(req.params.userId || "")) return res.status(400).json({ message: "userId must be a valid UUID." });
  req.params.userId = req.params.userId.toLowerCase();
  next();
}
module.exports = { normalizePatch, validateUserId, keys, text, fail };
