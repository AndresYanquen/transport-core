const allowedKeys = [
  "client_driver_search_radius_meters",
  "driver_request_search_radius_meters",
];

function validateUpdate(req, res, next) {
  const body = req.body || {};
  const settings = body.settings || {};

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return res.status(400).json({ message: "settings must be an object." });
  }

  const payload = {};

  for (const key of allowedKeys) {
    if (settings[key] === undefined) continue;

    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < 100 || value > 100000) {
      return res.status(400).json({
        message: `${key} must be a number between 100 and 100000 meters.`,
      });
    }

    payload[key] = String(Math.trunc(value));
  }

  if (!Object.keys(payload).length) {
    return res.status(400).json({
      message: `settings must include at least one of: ${allowedKeys.join(", ")}.`,
    });
  }

  req.operationalParametersPayload = payload;
  next();
}

module.exports = {
  allowedKeys,
  validateUpdate,
};
