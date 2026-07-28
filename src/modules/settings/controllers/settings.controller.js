const SettingsService = require("../services/settings.service");

async function getOperationalSettings(_req, res, next) {
  try {
    const settings = await SettingsService.getOperationalSettings();
    res.status(200).json({ settings });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getOperationalSettings,
};
