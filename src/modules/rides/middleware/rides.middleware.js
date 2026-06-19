const { RideStatus } = require("../constants/ride-status");
const ServiceTypeService = require("../../service-types/services/service-type.service");

const DEFAULT_SERVICE_TYPE = "standard";

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

async function validateCreateRide(req, res, next) {
  const {
    clientId,
    pickupAddress,
    dropoffAddress,
    pickupLocation,
    dropoffLocation,
    requestDescription,
    hasDestination,
    serviceType = DEFAULT_SERVICE_TYPE,
    estimatedDistanceMeters,
    estimatedDurationSeconds,
    estimatedFareAmount,
    surgeMultiplier,
    currency,
  } = req.body || {};

  if (!clientId) {
    return res.status(400).json({ message: "clientId is required." });
  }

  if (!pickupAddress || typeof pickupAddress !== "string" || !pickupAddress.trim()) {
    return res.status(400).json({
      message: "pickupAddress is required.",
    });
  }

  if (dropoffAddress !== undefined && dropoffAddress !== null) {
    if (typeof dropoffAddress !== "string") {
      return res.status(400).json({
        message: "dropoffAddress must be a string when provided.",
      });
    }
  }

  if (hasDestination !== undefined && typeof hasDestination !== "boolean") {
    return res.status(400).json({
      message: "hasDestination must be a boolean when provided.",
    });
  }

  const pickupPointWkt = toWktPoint(pickupLocation);
  if (!pickupPointWkt) {
    return res.status(400).json({
      message: "pickupLocation must include valid lat/lng values.",
    });
  }

  const dropoffPointWkt = toWktPoint(dropoffLocation);
  const resolvedHasDestination =
    hasDestination !== undefined
      ? hasDestination
      : Boolean(dropoffPointWkt || (dropoffAddress && dropoffAddress.trim()));

  if (resolvedHasDestination && (!dropoffPointWkt || !dropoffAddress || !dropoffAddress.trim())) {
    return res.status(400).json({
      message:
        "When hasDestination is true, dropoffLocation and dropoffAddress are required.",
    });
  }

  if (typeof serviceType !== "string" || !serviceType.trim()) {
    return res.status(400).json({
      message: "serviceType must be a non-empty string.",
    });
  }

  let activeServiceTypes;
  try {
    activeServiceTypes = await ServiceTypeService.listActiveServiceTypes();
  } catch (error) {
    return next(error);
  }

  const activeServiceType = activeServiceTypes.find(
    (activeType) => activeType.code === serviceType
  );

  if (!activeServiceType) {
    return res.status(400).json({
      message: `serviceType must be one of the active service types: ${activeServiceTypes
        .map((activeType) => activeType.code)
        .join(", ")}`,
    });
  }

  const isDeliveryService = activeServiceType.category === "delivery";
  if (isDeliveryService && !resolvedHasDestination) {
    return res.status(400).json({
      message:
        "Delivery service types require dropoffLocation and dropoffAddress.",
    });
  }

  if (isDeliveryService) {
    if (
      typeof requestDescription !== "string" ||
      !requestDescription.trim()
    ) {
      return res.status(400).json({
        message: "requestDescription is required for delivery service types.",
      });
    }

    req.body.requestDescription = requestDescription.trim();
  } else if (requestDescription !== undefined && requestDescription !== null) {
    if (typeof requestDescription !== "string") {
      return res.status(400).json({
        message: "requestDescription must be a string when provided.",
      });
    }

    req.body.requestDescription = requestDescription.trim() || null;
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
  req.body.hasDestination = resolvedHasDestination;
  req.body.pickupAddress = pickupAddress.trim();
  req.body.serviceType = serviceType;

  if (resolvedHasDestination) {
    req.body.dropoffPointWkt = dropoffPointWkt;
    req.body.dropoffAddress = dropoffAddress.trim();
  } else {
    req.body.dropoffPointWkt = null;
    req.body.dropoffAddress = null;
    req.body.dropoffLocation = null;
  }

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

function validateRateRide(req, res, next) {
  const { stars, comment, tags } = req.body || {};

  if (stars === undefined || stars === null) {
    return res.status(400).json({ message: "stars is required." });
  }

  const parsedStars = Number(stars);
  if (!Number.isInteger(parsedStars) || parsedStars < 1 || parsedStars > 5) {
    return res.status(400).json({
      message: "stars must be an integer between 1 and 5.",
    });
  }

  if (comment !== undefined && comment !== null && typeof comment !== "string") {
    return res.status(400).json({
      message: "comment must be a string when provided.",
    });
  }

  if (tags !== undefined && tags !== null && !Array.isArray(tags)) {
    return res.status(400).json({
      message: "tags must be an array of strings when provided.",
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
  rateRide: validateRateRide,
};
