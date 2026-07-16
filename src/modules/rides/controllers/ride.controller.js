const RideService = require("../services/ride.service");
const RideRatingService = require("../services/ride-rating.service");

async function createRide(req, res, next) {
  try {
    const result = await RideService.createRide(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateRideStatus(req, res, next) {
  try {
    const { status, actorType, actorId, payload, ...rest } = req.body;

    const result = await RideService.updateRideStatus({
      rideId: req.params.rideId,
      nextStatus: status,
      actorType,
      actorId,
      payload,
      ...rest,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getRide(req, res, next) {
  try {
    const { includeEvents, includeDriver, includePassenger, includeRatings, eventsLimit } =
      req.query;

    const includeEventsFlag =
      typeof includeEvents === "string"
        ? ["true", "1", "yes"].includes(includeEvents.toLowerCase())
        : Boolean(includeEvents);
    const includeDriverFlag =
      typeof includeDriver === "string"
        ? ["true", "1", "yes"].includes(includeDriver.toLowerCase())
        : Boolean(includeDriver);
    const includePassengerFlag =
      typeof includePassenger === "string"
        ? ["true", "1", "yes"].includes(includePassenger.toLowerCase())
        : Boolean(includePassenger);
    const includeRatingsFlag =
      typeof includeRatings === "string"
        ? ["true", "1", "yes"].includes(includeRatings.toLowerCase())
        : Boolean(includeRatings);

    const limit = eventsLimit ? Number(eventsLimit) : undefined;

    const result = await RideService.getRideById(req.params.rideId, {
      includeEvents: includeEventsFlag,
      includeDriver: includeDriverFlag,
      includePassenger: includePassengerFlag,
      includeRatings: includeRatingsFlag,
      eventsLimit: limit,
    }, req.user);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function rateRide(req, res, next) {
  try {
    const { stars, comment, tags } = req.body || {};
    const result = await RideRatingService.rateRide(
      { rideId: req.params.rideId, stars, comment, tags },
      req.user
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function listRides(req, res, next) {
  try {
    const result = await RideService.listRides(req.query, req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function listDriverInvites(req, res, next) {
  try {
    const result = await RideService.listDriverInvites(req.query, req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function listRideDriverInvites(req, res, next) {
  try {
    const result = await RideService.listRideDriverInvites(
      req.params.rideId,
      req.query,
      req.user
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function listNearbyDrivers(req, res, next) {
  try {
    const result = await RideService.listNearbyDriversForRide(
      req.params.rideId,
      req.query,
      req.user
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function listRecentRideEvents(req, res, next) {
  try {
    const result = await RideService.listRecentRideEvents(req.query, req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function assignDriver(req, res, next) {
  try {
    const { driverId, radiusMeters, limit, actorType, actorId } = req.body;

    const result = await RideService.assignDriver({
      rideId: req.params.rideId,
      driverId,
      radiusMeters,
      limit,
      actorType,
      actorId,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function respondDriverAssignment(req, res, next) {
  try {
    const { driverId, action, actorType, actorId } = req.body;

    const result = await RideService.respondDriverAssignment({
      rideId: req.params.rideId,
      driverId,
      action,
      actorType,
      actorId,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function claimRide(req, res, next) {
  try {
    const result = await RideService.claimRide({
      rideId: req.params.rideId,
      driverId: req.user.id,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function driverProgress(req, res, next) {
  try {
    const {
      driverId,
      status,
      actorType,
      actorId,
      actualDistanceMeters,
      actualDurationSeconds,
      finalFareAmount,
      paymentReference,
      surgeMultiplier,
      pricingBreakdown,
      cancellationReason,
      payload,
    } = req.body;

    const result = await RideService.driverProgress({
      rideId: req.params.rideId,
      driverId,
      status,
      actorType,
      actorId,
      actualDistanceMeters,
      actualDurationSeconds,
      finalFareAmount,
      paymentReference,
      surgeMultiplier,
      pricingBreakdown,
      cancellationReason,
      payload,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function cancelRide(req, res, next) {
  try {
    const { actorType, actorId, cancellationReason, payload } = req.body;
    const result = await RideService.cancelRide({
      rideId: req.params.rideId,
      actorType,
      actorId,
      cancellationReason,
      payload,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function markNoShow(req, res, next) {
  try {
    const { actorType, actorId, driverId, payload, cancellationReason } = req.body;
    const result = await RideService.markNoShow({
      rideId: req.params.rideId,
      actorType,
      actorId,
      driverId,
      payload,
      cancellationReason,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function requeueRide(req, res, next) {
  try {
    const { actorType, actorId, payload } = req.body;
    const result = await RideService.requeueRide({
      rideId: req.params.rideId,
      actorType,
      actorId,
      payload,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function systemCancelRide(req, res, next) {
  try {
    const { actorId, payload, cancellationReason } = req.body;
    const result = await RideService.systemCancelRide({
      rideId: req.params.rideId,
      actorId,
      payload,
      cancellationReason,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createRide,
  listRides,
  listDriverInvites,
  listRideDriverInvites,
  listNearbyDrivers,
  listRecentRideEvents,
  updateRideStatus,
  getRide,
  assignDriver,
  claimRide,
  respondDriverAssignment,
  driverProgress,
  cancelRide,
  markNoShow,
  requeueRide,
  systemCancelRide,
  rateRide,
};
