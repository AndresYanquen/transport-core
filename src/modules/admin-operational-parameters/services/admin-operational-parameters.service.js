const SettingsModel = require("../../settings/models/settings.model");
const SettingsService = require("../../settings/services/settings.service");
const { allowedKeys } = require("../middleware/admin-operational-parameters.middleware");
const { settingDefinitions } = require("../../settings/settings.definitions");

const descriptions = Object.fromEntries(
  Object.entries(settingDefinitions).map(([key, definition]) => [key, definition.description])
);

async function listParameters() {
  const settings = await SettingsService.getSettings(allowedKeys, { ttlMs: 0 });

  return {
    settings: Object.fromEntries(
      allowedKeys.map((key) => [
        key,
        settings[key] || {
          key,
          value: "",
          description: descriptions[key],
          createdAt: null,
          updatedAt: null,
        },
      ]),
    ),
  };
}

async function updateParameters(payload) {
  const updated = {};

  for (const [key, value] of Object.entries(payload)) {
    updated[key] = await SettingsModel.upsert({
      key,
      value,
      description: descriptions[key],
    });
    SettingsService.clearCache(key);
  }

  return {
    settings: updated,
  };
}

module.exports = {
  listParameters,
  updateParameters,
};
