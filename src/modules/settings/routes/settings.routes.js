const { Router } = require("express");

const SettingsController = require("../controllers/settings.controller");

const router = Router();

router.get("/operational", SettingsController.getOperationalSettings);

module.exports = router;
