const allowedServiceTypes = ["standard", "premium", "pool"];

const { RideStatus } = require("../constants/ride-status");

function toWktPoint(location) {
  if (!location) return null;

  const { lat, latitude, lng, lon, longitude } = location;
  const latitudeValue = typeof latitude === "number" ? latitude : lat;
  const longitudeValue =
    typeof longitude === "number"
      ? longitude
      : typeof lng === "number"
      ? lng
      : lon;

  if (
    typeof latitudeValue !== "number" ||
    typeof longitudeValue !== "number" ||
    Number.isNaN(latitudeValue) ||
    Number.isNaN(longitudeValue) ||
    latitudeValue < -90 ||
    latitudeValue > 90 ||
    longitudeValue < -180 ||
    longitudeValue > 180
  ) {
    return null;
  }

  return `SRID=4326;POINT(${longitudeValue} ${latitudeValue})`;
}

function validateCreateRide(req, res, next) {
  const {
    clientId,
    pickupLocation,
    dropoffLocation,
    serviceType = "standard",
    estimatedDistanceMeters,
    estimatedDurationSeconds,
    estimatedFareAmount,
    surgeMultiplier,
    currency,
  } = req.body || {};

  if (!clientId) {
    return res.status(400).json({ message: "clientId is required." });
  }

  const pickupPointWkt = toWktPoint(pickupLocation);
  const dropoffPointWkt = toWktPoint(dropoffLocation);

  if (!pickupPointWkt || !dropoffPointWkt) {
    return res.status(400).json({
      message: "pickupLocation and dropoffLocation must include valid lat/lng values.",
    });
  }

  if (!allowedServiceTypes.includes(serviceType)) {
    return res.status(400).json({
      message: `serviceType must be one of: ${allowedServiceTypes.join(", ")}`,
    });
  }

  if (
    estimatedDistanceMeters !== undefined &&
    (Number.isNaN(Number(estimatedDistanceMeters)) ||
      Number(estimatedDistanceMeters) < 0)
  ) {
    return res
      .status(400)
      .json({ message: "estimatedDistanceMeters must be a positive number." });
  }

  if (
    estimatedDurationSeconds !== undefined &&
    (Number.isNaN(Number(estimatedDurationSeconds)) ||
      Number(estimatedDurationSeconds) < 0)
  ) {
    return res.status(400).json({
      message: "estimatedDurationSeconds must be a positive number.",
    });
  }

  if (
    estimatedFareAmount !== undefined &&
    (Number.isNaN(Number(estimatedFareAmount)) ||
      Number(estimatedFareAmount) < 0)
  ) {
    return res
      .status(400)
      .json({ message: "estimatedFareAmount must be a positive number." });
  }

  if (
    surgeMultiplier !== undefined &&
    (Number.isNaN(Number(surgeMultiplier)) || Number(surgeMultiplier) < 1)
  ) {
    return res
      .status(400)
      .json({ message: "surgeMultiplier must be at least 1." });
  }

  if (currency && typeof currency !== "string") {
    return res
      .status(400)
      .json({ message: "currency must be a valid ISO currency string." });
  }

  req.body.pickupPointWkt = pickupPointWkt;
  req.body.dropoffPointWkt = dropoffPointWkt;

  next();
}

function validateAssignDriver(req, res, next) {
  const { driverId, radiusMeters, limit, actorType, actorId } = req.body || {};

  if (driverId !== undefined && typeof driverId !== "string") {
    return res.status(400).json({ message: "driverId must be a string." });
  }

  if (radiusMeters !== undefined) {
    const parsedRadius = Number(radiusMeters);
    if (Number.isNaN(parsedRadius) || parsedRadius <= 0) {
      return res
        .status(400)
        .json({ message: "radiusMeters must be a positive number." });
    }
    req.body.radiusMeters = parsedRadius;
  }

  if (limit !== undefined) {
    const parsedLimit = Number(limit);
    if (
      Number.isNaN(parsedLimit) ||
      parsedLimit <= 0 ||
      !Number.isInteger(parsedLimit)
    ) {
      return res
        .status(400)
        .json({ message: "limit must be a positive integer." });
    }
    req.body.limit = parsedLimit;
  }

  if (actorType !== undefined && typeof actorType !== "string") {
    return res.status(400).json({ message: "actorType must be a string." });
  }

  if (actorId !== undefined && typeof actorId !== "string") {
    return res.status(400).json({ message: "actorId must be a string." });
  }

  next();
}

function validateDriverResponse(req, res, next) {
  const { driverId, action, actorType, actorId } = req.body || {};

  if (!driverId || typeof driverId !== "string") {
    return res.status(400).json({ message: "driverId is required." });
  }

  if (!action || typeof action !== "string") {
    return res.status(400).json({ message: "action must be provided." });
  }

  const normalizedAction = action.toLowerCase();
  if (!["accept", "reject"].includes(normalizedAction)) {
    return res
      .status(400)
      .json({ message: 'action must be either "accept" or "reject".' });
  }

  if (actorType !== undefined && typeof actorType !== "string") {
    return res.status(400).json({ message: "actorType must be a string." });
  }

  if (actorId !== undefined && typeof actorId !== "string") {
    return res.status(400).json({ message: "actorId must be a string." });
  }

  next();
}

function validateDriverProgress(req, res, next) {
  const {
    driverId,
    status,
    actualDistanceMeters,
    actualDurationSeconds,
    finalFareAmount,
    cancellationReason,
    actorType,
    actorId,
  } = req.body || {};

  if (!driverId || typeof driverId !== "string") {
    return res.status(400).json({ message: "driverId is required." });
  }

  if (!status || typeof status !== "string") {
    return res.status(400).json({ message: "status is required." });
  }

  const normalizedStatus = status.toLowerCase();
  const allowedStatuses = [
    RideStatus.DRIVER_EN_ROUTE,
    RideStatus.DRIVER_ARRIVED,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
    RideStatus.CANCELED_BY_DRIVER,
  ];

  if (!allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({
      message: `status must be one of: ${allowedStatuses.join(", ")}`,
    });
  }

  if (actorType !== undefined && typeof actorType !== "string") {
    return res.status(400).json({ message: "actorType must be a string." });
  }

  if (actorId !== undefined && typeof actorId !== "string") {
    return res.status(400).json({ message: "actorId must be a string." });
  }

  if (normalizedStatus === RideStatus.COMPLETED) {
    const distance = Number(actualDistanceMeters);
    const duration = Number(actualDurationSeconds);
    const fare = Number(finalFareAmount);

    if (
      Number.isNaN(distance) ||
      distance <= 0 ||
      Number.isNaN(duration) ||
      duration <= 0 ||
      Number.isNaN(fare) ||
      fare <= 0
    ) {
      return res.status(400).json({
        message:
          "actualDistanceMeters, actualDurationSeconds, and finalFareAmount must be positive numbers when completing a ride.",
      });
    }

    req.body.actualDistanceMeters = distance;
    req.body.actualDurationSeconds = duration;
    req.body.finalFareAmount = fare;
  } else {
    if (actualDistanceMeters !== undefined) {
      req.body.actualDistanceMeters = Number(actualDistanceMeters);
      if (Number.isNaN(req.body.actualDistanceMeters)) {
        return res
          .status(400)
          .json({ message: "actualDistanceMeters must be a number." });
      }
    }
    if (actualDurationSeconds !== undefined) {
      req.body.actualDurationSeconds = Number(actualDurationSeconds);
      if (Number.isNaN(req.body.actualDurationSeconds)) {
        return res
          .status(400)
          .json({ message: "actualDurationSeconds must be a number." });
      }
    }
    if (finalFareAmount !== undefined) {
      req.body.finalFareAmount = Number(finalFareAmount);
      if (Number.isNaN(req.body.finalFareAmount)) {
        return res
          .status(400)
          .json({ message: "finalFareAmount must be a number." });
      }
    }
  }

  if (
    normalizedStatus === RideStatus.CANCELED_BY_DRIVER &&
    cancellationReason !== undefined &&
    typeof cancellationReason !== "string"
  ) {
    return res
      .status(400)
      .json({ message: "cancellationReason must be a string." });
  }

  next();
}

function validateStatusUpdate(req, res, next) {
  const {
    status,
    driverId,
    actualDistanceMeters,
    actualDurationSeconds,
    finalFareAmount,
    cancellationReason,
  } = req.body || {};

  if (!status || typeof status !== "string") {
    return res.status(400).json({ message: "status is required." });
  }

  if (driverId !== undefined && typeof driverId !== "string") {
    return res.status(400).json({ message: "driverId must be a string." });
  }

  if (status === RideStatus.DRIVER_ASSIGNED && !driverId) {
    return res.status(400).json({
      message: "driverId is required when setting status to driver_assigned.",
    });
  }

  if (status === RideStatus.COMPLETED) {
    const distance = Number(actualDistanceMeters);
    const duration = Number(actualDurationSeconds);
    const fare = Number(finalFareAmount);

    if (
      Number.isNaN(distance) ||
      distance <= 0 ||
      Number.isNaN(duration) ||
      duration <= 0 ||
      Number.isNaN(fare) ||
      fare <= 0
    ) {
      return res.status(400).json({
        message:
          "actualDistanceMeters, actualDurationSeconds, and finalFareAmount must be positive numbers when completing a ride.",
      });
    }
  }

  if (
    cancellationReason !== undefined &&
    typeof cancellationReason !== "string"
  ) {
    return res.status(400).json({
      message: "cancellationReason must be a string when provided.",
    });
  }

  next();
}

function validateCancelRide(req, res, next) {
  const { cancellationReason } = req.body || {};
  if (
    cancellationReason !== undefined &&
    typeof cancellationReason !== "string"
  ) {
    return res.status(400).json({
      message: "cancellationReason must be a string when provided.",
    });
  }
  next();
}

function validateNoShow(req, res, next) {
  const { driverId, cancellationReason } = req.body || {};
  if (driverId !== undefined && typeof driverId !== "string") {
    return res.status(400).json({ message: "driverId must be a string." });
  }
  if (
    cancellationReason !== undefined &&
    typeof cancellationReason !== "string"
  ) {
    return res.status(400).json({
      message: "cancellationReason must be a string when provided.",
    });
  }
  next();
}

module.exports = {
  createRide: validateCreateRide,
  assignDriver: validateAssignDriver,
  driverResponse: validateDriverResponse,
  driverProgress: validateDriverProgress,
  updateRideStatus: validateStatusUpdate,
  cancelRide: validateCancelRide,
  markNoShow: validateNoShow,
  requeueRide: (_req, _res, next) => next(),
  systemCancelRide: validateCancelRide,
};
