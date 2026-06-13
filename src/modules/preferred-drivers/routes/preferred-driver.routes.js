const { Router } = require("express");

const PreferredDriverController = require("../controllers/preferred-driver.controller");
const PreferredDriverMiddleware = require("../middleware/preferred-driver.middleware");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();

router.get(
  "/",
  authorizeRoles("client", "admin"),
  PreferredDriverMiddleware.validateListQuery,
  PreferredDriverController.listPreferredDrivers
);

router.post(
  "/",
  authorizeRoles("client", "admin"),
  PreferredDriverMiddleware.validateDriverId,
  PreferredDriverController.addPreferredDriver
);

router.get(
  "/:driverId",
  authorizeRoles("client", "admin"),
  PreferredDriverMiddleware.validateDriverId,
  PreferredDriverController.getPreferredDriver
);

router.delete(
  "/:driverId",
  authorizeRoles("client", "admin"),
  PreferredDriverMiddleware.validateDriverId,
  PreferredDriverController.removePreferredDriver
);

module.exports = router;
