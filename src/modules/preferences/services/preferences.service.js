const PreferencesModel = require("../models/preferences.model");

const DEFAULT_PREFERENCES = {
  theme: "system",
  language: "en",
};

function buildNotFoundError() {
  const error = new Error("Preferences were not found for this user.");
  error.status = 404;
  return error;
}

function withDefaults(preferences = {}) {
  return {
    ...DEFAULT_PREFERENCES,
    ...(preferences || {}),
  };
}

async function getPreferences(user) {
  const preferences = await PreferencesModel.findUserPreferencesByUserId(user.id);

  if (!preferences) {
    throw buildNotFoundError();
  }

  return {
    preferences: withDefaults(preferences),
  };
}

async function updatePreferences(user, patch) {
  const currentPreferences = await PreferencesModel.findUserPreferencesByUserId(user.id);

  if (!currentPreferences) {
    throw buildNotFoundError();
  }

  const nextPreferences = {
    ...currentPreferences,
    ...patch,
  };

  const preferences = await PreferencesModel.updateUserPreferences(user.id, nextPreferences);

  return {
    preferences: withDefaults(preferences),
  };
}

module.exports = {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreferences,
  __private: {
    withDefaults,
  },
};
