const { Router } = require("express");

const DriverController = require("../controllers/driver.controller");
const driverMiddleware = require("../middleware/driver.middleware");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();

function ensureDriverOwnsResource(req, res, next) {
  const role = (req.user?.role || "").toLowerCase();

  if (role === "driver" && req.user?.id !== req.params.driverId) {
    return res
      .status(403)
      .json({ message: "Drivers may only modify their own profile." });
  }

  next();
}

router.patch(
  "/:driverId/location",
  authorizeRoles("driver", "admin"),
  ensureDriverOwnsResource,
  driverMiddleware.updateLocation,
  DriverController.updateLocation
);

router.patch(
  "/:driverId/status",
  authorizeRoles("driver", "admin"),
  ensureDriverOwnsResource,
  driverMiddleware.updateStatus,
  DriverController.updateStatus
);

module.exports = router;
