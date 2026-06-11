const { Router } = require("express");

const PreferencesController = require("../controllers/preferences.controller");
const PreferencesMiddleware = require("../middleware/preferences.middleware");

const router = Router();

router.get("/", PreferencesController.getPreferences);
router.patch(
  "/",
  PreferencesMiddleware.validatePreferencesPatch,
  PreferencesController.updatePreferences
);

module.exports = router;
