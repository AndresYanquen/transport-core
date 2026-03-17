const { Router } = require("express");
const RideController = require("../controllers/ride.controller");
const RideMiddleware = require("../middleware/rides.middleware");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();

function normalizeRole(role = "") {
  return role.toLowerCase();
}

function ensureClientOwnsRideRequest(req, res, next) {
  if (!req.body) {
    req.body = {};
  }

  const role = normalizeRole(req.user?.role);

  if (role === "client") {
    if (req.body.clientId && req.body.clientId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Clients can only create rides for their own account." });
    }
    req.body.clientId = req.user.id;
    req.body.actorType = "client";
    req.body.actorId = req.user.id;
  } else if (role === "admin") {
    if (!req.body.actorType) {
      req.body.actorType = "system";
    }
    if (!req.body.actorId) {
      req.body.actorId = req.user.id;
    }
  }

  next();
}

function enforceDriverIdentity(req, res, next) {
  if (!req.body) {
    req.body = {};
  }

  const role = normalizeRole(req.user?.role);

  if (role === "driver") {
    if (req.body.driverId && req.body.driverId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Drivers can only act on rides for their own account." });
    }
    req.body.driverId = req.user.id;
    req.body.actorType = "driver";
    req.body.actorId = req.user.id;
  } else if (role === "admin") {
    if (!req.body.actorType) {
      req.body.actorType = "system";
    }
    if (!req.body.actorId) {
      req.body.actorId = req.user.id;
    }
  }

  next();
}

function applyActorMetadata(req, _res, next) {
  if (!req.body) {
    req.body = {};
  }

  const role = normalizeRole(req.user?.role);

  if (role === "driver") {
    req.body.actorType = "driver";
    req.body.actorId = req.user.id;
  } else if (role === "client") {
    req.body.actorType = "client";
    req.body.actorId = req.user.id;
  } else if (role === "admin" && !req.body.actorType) {
    req.body.actorType = "system";
    req.body.actorId = req.user.id;
  }

  next();
}

router.post(
  "/",
  authorizeRoles("client", "admin"),
  ensureClientOwnsRideRequest,
  RideMiddleware.createRide,
  RideController.createRide
);
router.get(
  "/",
  authorizeRoles("client", "driver", "admin"),
  RideController.listRides
);
router.patch(
  "/:rideId/assign",
  authorizeRoles("admin"),
  RideMiddleware.assignDriver,
  RideController.assignDriver
);
router.patch(
  "/:rideId/driver-response",
  authorizeRoles("driver"),
  enforceDriverIdentity,
  RideMiddleware.driverResponse,
  RideController.respondDriverAssignment
);
router.patch(
  "/:rideId/driver-progress",
  authorizeRoles("driver", "admin"),
  enforceDriverIdentity,
  RideMiddleware.driverProgress,
  RideController.driverProgress
);
router.patch(
  "/:rideId/status",
  authorizeRoles("client", "driver", "admin"),
  applyActorMetadata,
  RideMiddleware.updateRideStatus,
  RideController.updateRideStatus
);
router.patch(
  "/:rideId/cancel",
  authorizeRoles("client", "driver", "admin"),
  applyActorMetadata,
  RideMiddleware.cancelRide,
  RideController.cancelRide
);
router.patch(
  "/:rideId/no-show",
  authorizeRoles("driver", "admin"),
  enforceDriverIdentity,
  RideMiddleware.markNoShow,
  RideController.markNoShow
);
router.patch(
  "/:rideId/requeue",
  authorizeRoles("admin"),
  applyActorMetadata,
  RideMiddleware.requeueRide,
  RideController.requeueRide
);
router.patch(
  "/:rideId/system-cancel",
  authorizeRoles("admin"),
  applyActorMetadata,
  RideMiddleware.systemCancelRide,
  RideController.systemCancelRide
);
router.get(
  "/:rideId",
  authorizeRoles("client", "driver", "admin"),
  RideController.getRide
);

module.exports = router;
