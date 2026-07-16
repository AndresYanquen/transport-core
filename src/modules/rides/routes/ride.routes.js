const { Router } = require("express");
const RideController = require("../controllers/ride.controller");
const RideMiddleware = require("../middleware/rides.middleware");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AuthModel = require("../../auth/models/auth.model");

const router = Router();
const uuidV4LikeRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

function normalizeRole(role = "") {
  return role.toLowerCase();
}

async function ensureClientOwnsRideRequest(req, res, next) {
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
    req.body.actorType = "system";
    req.body.actorId = req.user.id;
  } else if (role === "operator") {
    req.body.actorType = "support";
    req.body.actorId = req.user.id;
    req.body.metadata = {
      ...(req.body.metadata || {}),
      createdByOperator: true,
      operatorId: req.user.id,
      source: req.body.metadata?.source || "operator_phone_call",
    };

    if (req.body.clientId) {
      return next();
    }

    const passenger = req.body.passenger || {};
    const phoneNumber = String(passenger.phoneNumber || req.body.passengerPhoneNumber || "").trim();
    if (!phoneNumber) {
      return res.status(400).json({
        message: "clientId or passenger.phoneNumber is required for operator-created rides.",
      });
    }

    try {
      const existingClient = await AuthModel.findClientByPhoneNumber(phoneNumber);
      const client =
        existingClient ||
        (await AuthModel.createPhoneOnlyClient({
          phoneNumber,
          firstName: passenger.firstName,
          lastName: passenger.lastName,
          createdByOperatorId: req.user.id,
        }));

      req.body.clientId = client.id;
      req.body.metadata.passenger = {
        phoneNumber,
        firstName: passenger.firstName || null,
        lastName: passenger.lastName || null,
        phoneOnlyClientCreated: !existingClient,
      };
    } catch (error) {
      return next(error);
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
    req.body.actorType = "system";
    req.body.actorId = req.user.id;
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
  } else if (role === "admin") {
    req.body.actorType = "system";
    req.body.actorId = req.user.id;
  } else if (role === "operator") {
    req.body.actorType = "system";
    req.body.actorId = req.user.id;
  }

  next();
}

function ensureValidRideId(req, res, next) {
  const { rideId } = req.params;

  if (!uuidV4LikeRegex.test(String(rideId || ""))) {
    return res.status(400).json({ message: "rideId must be a valid UUID." });
  }

  next();
}

router.post(
  "/",
  authorizeRoles("client", "admin", "operator"),
  ensureClientOwnsRideRequest,
  RideMiddleware.createRide,
  RideController.createRide
);
router.get(
  "/",
  authorizeRoles("client", "driver", "admin", "operator"),
  RideController.listRides
);
router.get(
  "/driver-invites",
  authorizeRoles("driver", "admin", "operator"),
  RideController.listDriverInvites
);
router.get(
  "/events/recent",
  authorizeRoles("admin", "operator"),
  RideController.listRecentRideEvents
);
router.patch(
  "/:rideId/assign",
  authorizeRoles("admin", "operator"),
  ensureValidRideId,
  applyActorMetadata,
  RideMiddleware.assignDriver,
  RideController.assignDriver
);
router.get(
  "/:rideId/driver-invites",
  authorizeRoles("admin", "operator"),
  ensureValidRideId,
  RideController.listRideDriverInvites
);
router.get(
  "/:rideId/nearby-drivers",
  authorizeRoles("admin", "operator"),
  ensureValidRideId,
  RideController.listNearbyDrivers
);
router.patch(
  "/:rideId/driver-response",
  authorizeRoles("driver"),
  ensureValidRideId,
  enforceDriverIdentity,
  RideMiddleware.driverResponse,
  RideController.respondDriverAssignment
);
router.post(
  "/:rideId/claim",
  authorizeRoles("driver"),
  ensureValidRideId,
  RideController.claimRide
);
router.patch(
  "/:rideId/driver-progress",
  authorizeRoles("driver", "admin"),
  ensureValidRideId,
  enforceDriverIdentity,
  RideMiddleware.driverProgress,
  RideController.driverProgress
);
router.patch(
  "/:rideId/status",
  authorizeRoles("client", "driver", "admin"),
  ensureValidRideId,
  applyActorMetadata,
  RideMiddleware.updateRideStatus,
  RideController.updateRideStatus
);
router.patch(
  "/:rideId/cancel",
  authorizeRoles("client", "driver", "admin"),
  ensureValidRideId,
  applyActorMetadata,
  RideMiddleware.cancelRide,
  RideController.cancelRide
);
router.patch(
  "/:rideId/no-show",
  authorizeRoles("driver", "admin"),
  ensureValidRideId,
  enforceDriverIdentity,
  RideMiddleware.markNoShow,
  RideController.markNoShow
);
router.patch(
  "/:rideId/requeue",
  authorizeRoles("admin", "operator"),
  ensureValidRideId,
  applyActorMetadata,
  RideMiddleware.requeueRide,
  RideController.requeueRide
);
router.patch(
  "/:rideId/system-cancel",
  authorizeRoles("admin"),
  ensureValidRideId,
  applyActorMetadata,
  RideMiddleware.systemCancelRide,
  RideController.systemCancelRide
);
router.post(
  "/:rideId/rate",
  authorizeRoles("client", "driver"),
  ensureValidRideId,
  RideMiddleware.rateRide,
  RideController.rateRide
);
router.get(
  "/:rideId",
  authorizeRoles("client", "driver", "admin", "operator"),
  ensureValidRideId,
  RideController.getRide
);

module.exports = router;
