const {
  settingDefinitions,
  validateSettingValue,
} = require("../../settings/settings.definitions");

const allowedKeys = Object.keys(settingDefinitions);

function validateUpdate(req, res, next) {
  const body = req.body || {};
  const settings = body.settings || {};

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return res.status(400).json({ message: "settings must be an object." });
  }

  const payload = {};

  for (const key of allowedKeys) {
    if (settings[key] === undefined) continue;
    payload[key] = validateSettingValue(key, settings[key]);
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
