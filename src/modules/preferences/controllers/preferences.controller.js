const PreferencesService = require("../services/preferences.service");

async function getPreferences(req, res, next) {
  try {
    const result = await PreferencesService.getPreferences(req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function updatePreferences(req, res, next) {
  try {
    const result = await PreferencesService.updatePreferences(req.user, req.preferencesPatch);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPreferences,
  updatePreferences,
};
