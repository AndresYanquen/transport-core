const RideModel = require("../models/ride.model");
const {
  RideStatus,
  RideActorType,
  RIDE_ACTOR_TYPES,
  TERMINAL_RIDE_STATUSES,
} = require("../constants/ride-status");
const {
  assertTransitionAllowed,
  isKnownStatus,
} = require("../utils/ride-state-machine");
const DriverService = require("../../drivers/services/driver.service");
const {
  RideInviteStatus,
  RIDE_INVITE_STATUS_VALUES,
} = require("../constants/ride-invite-status");
const { applyTransitionSideEffects } = require("./ride-effects.service");

const pool = RideModel.getPool();

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeActorType(actorType, fallback = RideActorType.SYSTEM) {
  if (!actorType) {
    return fallback;
  }

  const normalized = actorType.toLowerCase();

  if (!RIDE_ACTOR_TYPES.includes(normalized)) {
    throw createHttpError(
      400,
      `Invalid actorType "${actorType}". Expected one of: ${RIDE_ACTOR_TYPES.join(", ")}`
    );
  }

  return normalized;
}

function normalizeCurrency(currency) {
  if (!currency) {
    return "USD";
  }

  return currency.trim().toUpperCase();
}

function normalizePaymentReference(paymentReference) {
  if (paymentReference === undefined || paymentReference === null) {
    return null;
  }

  if (typeof paymentReference !== "string") {
    throw createHttpError(400, "paymentReference must be a string when provided.");
  }

  const trimmed = paymentReference.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLocationInput(label, value, { required = true } = {}) {
  if (!value) {
    if (required) {
      throw createHttpError(400, `${label} is required and must include lat/lng.`);
    }
    return null;
  }

  const lat = Number(value.lat);
  const lng = Number(value.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw createHttpError(
      400,
      `${label}.lat must be a valid latitude between -90 and 90.`
    );
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw createHttpError(
      400,
      `${label}.lng must be a valid longitude between -180 and 180.`
    );
  }

  return { lat, lng };
}

function locationToWkt(location) {
  if (!location) {
    return null;
  }

  const { lat, lng } = location;

  if (lat === undefined || lng === undefined) {
    return null;
  }

  return `SRID=4326;POINT(${lng} ${lat})`;
}

function buildStatusTimestampExpressions(nextStatus, currentRow) {
  const expressions = [];

  switch (nextStatus) {
    case RideStatus.DRIVER_ASSIGNED:
      if (!currentRow.accepted_at) {
        expressions.push("accepted_at = NOW()");
      }
      break;
    case RideStatus.DRIVER_ARRIVED:
      if (!currentRow.driver_arrived_at) {
        expressions.push("driver_arrived_at = NOW()");
      }
      break;
    case RideStatus.IN_PROGRESS:
      if (!currentRow.started_at) {
        expressions.push("started_at = NOW()");
      }
      break;
    case RideStatus.COMPLETED:
      if (!currentRow.completed_at) {
        expressions.push("completed_at = NOW()");
      }
      break;
    case RideStatus.CANCELED_BY_CLIENT:
    case RideStatus.CANCELED_BY_DRIVER:
    case RideStatus.CANCELED_BY_SYSTEM:
    case RideStatus.NO_SHOW:
      if (!currentRow.canceled_at) {
        expressions.push("canceled_at = NOW()");
      }
      break;
    default:
      break;
  }

  expressions.push("updated_at = NOW()");
  return expressions;
}

function toNullableNumber(value, fieldName, { positive = false } = {}) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || (positive && parsed <= 0)) {
    throw createHttpError(
      400,
      `${fieldName} must be ${positive ? "a positive" : "a valid"} number.`
    );
  }

  return parsed;
}

function validateTransitionPayload({
  currentRow,
  toStatus,
  actorType,
  driverId,
  actualDistanceMeters,
  actualDurationSeconds,
  finalFareAmount,
  cancellationReason,
}) {
  const assignedStatuses = new Set([
    RideStatus.DRIVER_ASSIGNED,
    RideStatus.DRIVER_EN_ROUTE,
    RideStatus.DRIVER_ARRIVED,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
  ]);

  if (toStatus === RideStatus.DRIVER_ASSIGNED && !driverId) {
    throw createHttpError(400, "driverId is required to assign a driver.");
  }

  if (
    actorType === RideActorType.DRIVER &&
    currentRow.driver_id &&
    driverId &&
    currentRow.driver_id !== driverId &&
    toStatus !== RideStatus.DRIVER_ASSIGNED
  ) {
    throw createHttpError(403, "Driver cannot act on a ride assigned to another driver.");
  }

  if (assignedStatuses.has(toStatus) && !(driverId || currentRow.driver_id)) {
    throw createHttpError(409, `Status "${toStatus}" requires an assigned driver.`);
  }

  if (toStatus === RideStatus.COMPLETED) {
    if (
      actualDistanceMeters === undefined ||
      actualDurationSeconds === undefined ||
      finalFareAmount === undefined
    ) {
      throw createHttpError(
        400,
        "actualDistanceMeters, actualDurationSeconds, and finalFareAmount are required to complete a ride."
      );
    }
    toNullableNumber(actualDistanceMeters, "actualDistanceMeters", {
      positive: true,
    });
    toNullableNumber(actualDurationSeconds, "actualDurationSeconds", {
      positive: true,
    });
    toNullableNumber(finalFareAmount, "finalFareAmount", {
      positive: true,
    });
  }

  if (
    [
      RideStatus.CANCELED_BY_CLIENT,
      RideStatus.CANCELED_BY_DRIVER,
      RideStatus.CANCELED_BY_SYSTEM,
      RideStatus.NO_SHOW,
    ].includes(toStatus) &&
    cancellationReason !== undefined &&
    typeof cancellationReason !== "string"
  ) {
    throw createHttpError(400, "cancellationReason must be a string when provided.");
  }
}

function buildTransitionPlan(currentRow, {
  toStatus,
  actorType,
  driverId,
  cancellationReason,
  actualDistanceMeters,
  actualDurationSeconds,
  finalFareAmount,
  paymentReference,
  surgeMultiplier,
  pricingBreakdown,
}) {
  validateTransitionPayload({
    currentRow,
    toStatus,
    actorType,
    driverId,
    actualDistanceMeters,
    actualDurationSeconds,
    finalFareAmount,
    cancellationReason,
  });

  const resolvedDriverId = driverId ?? currentRow.driver_id ?? null;
  const updateFields = {
    status: toStatus,
  };

  if (toStatus === RideStatus.DRIVER_ASSIGNED) {
    updateFields.driver_id = resolvedDriverId;
  }

  if (toStatus === RideStatus.PENDING_DRIVER) {
    updateFields.driver_id = null;
  }

  if (cancellationReason !== undefined) {
    updateFields.cancellation_reason = cancellationReason;
  }

  const distance = toNullableNumber(actualDistanceMeters, "actualDistanceMeters");
  const duration = toNullableNumber(actualDurationSeconds, "actualDurationSeconds");
  const fare = toNullableNumber(finalFareAmount, "finalFareAmount");
  const surge = toNullableNumber(surgeMultiplier, "surgeMultiplier");

  if (distance !== undefined) {
    updateFields.actual_distance_meters = distance;
  }

  if (duration !== undefined) {
    updateFields.actual_duration_seconds = duration;
  }

  if (fare !== undefined) {
    updateFields.final_fare_amount = fare;
  }

  if (paymentReference !== undefined) {
    updateFields.payment_reference = normalizePaymentReference(paymentReference);
  }

  if (surge !== undefined) {
    updateFields.surge_multiplier = surge;
  }

  if (pricingBreakdown !== undefined) {
    updateFields.pricing_breakdown = JSON.stringify(pricingBreakdown ?? {});
  }

  return {
    resolvedDriverId,
    previousDriverId: currentRow.driver_id,
    updateFields,
    expressions: buildStatusTimestampExpressions(toStatus, currentRow),
  };
}

async function transitionRide(dbClient, {
  rideId,
  toStatus,
  actorType,
  actorId,
  driverId,
  payload,
  cancellationReason,
  actualDistanceMeters,
  actualDurationSeconds,
  finalFareAmount,
  paymentReference,
  surgeMultiplier,
  pricingBreakdown,
}) {
  const currentRow = await RideModel.getRideByIdForUpdate(rideId, dbClient);

  if (!currentRow) {
    throw createHttpError(404, `Ride ${rideId} not found.`);
  }

  if (TERMINAL_RIDE_STATUSES.has(currentRow.status) && currentRow.status !== toStatus) {
    throw createHttpError(
      409,
      `Ride is in terminal status "${currentRow.status}" and cannot transition further.`
    );
  }

  assertTransitionAllowed({
    fromStatus: currentRow.status,
    toStatus,
    actorType,
  });

  const plan = buildTransitionPlan(currentRow, {
    toStatus,
    actorType,
    driverId,
    cancellationReason,
    actualDistanceMeters,
    actualDurationSeconds,
    finalFareAmount,
    paymentReference,
    surgeMultiplier,
    pricingBreakdown,
  });

  const updatedRow = await RideModel.updateRide(dbClient, rideId, {
    fields: plan.updateFields,
    expressions: plan.expressions,
  });

  await applyTransitionSideEffects(dbClient, {
    rideId,
    fromStatus: currentRow.status,
    toStatus,
    driverId: plan.resolvedDriverId,
    previousDriverId: plan.previousDriverId,
  });

  const eventRow = await RideModel.insertRideEvent(dbClient, {
    rideId,
    status: toStatus,
    actorType,
    actorId: actorId ?? null,
    payload: {
      ...(payload ?? {}),
      previousStatus: currentRow.status,
      driverId: plan.resolvedDriverId,
    },
  });

  return {
    ride: RideModel.mapRideRow(updatedRow),
    event: RideModel.mapEventRow(eventRow),
    previousStatus: currentRow.status,
  };
}

async function createRide({
  clientId,
  serviceType = "standard",
  pickupAddress,
  dropoffAddress,
  pickupLocation,
  dropoffLocation,
  estimatedDistanceMeters,
  estimatedDurationSeconds,
  estimatedFareAmount,
  surgeMultiplier = 1,
  currency = "USD",
  paymentReference,
  pricingBreakdown,
  scheduledAt,
  actorType = RideActorType.CLIENT,
  actorId,
  metadata,
  autoAssign = true,
  autoAssignRadiusMeters = 5000,
  autoAssignLimit = 5,
}) {
  if (!clientId) {
    throw createHttpError(400, "clientId is required to create a ride.");
  }

  const normalizedActorType = normalizeActorType(actorType, RideActorType.CLIENT);
  const normalizedPickupLocation = normalizeLocationInput(
    "pickupLocation",
    pickupLocation,
    { required: true }
  );
  const normalizedDropoffLocation = normalizeLocationInput(
    "dropoffLocation",
    dropoffLocation,
    { required: true }
  );

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const rideRow = await RideModel.insertRide(dbClient, {
      clientId,
      status: RideStatus.REQUESTED,
      serviceType,
      pickupAddress,
      dropoffAddress,
      pickupLocation: normalizedPickupLocation,
      dropoffLocation: normalizedDropoffLocation,
      estimatedDistanceMeters,
      estimatedDurationSeconds,
      estimatedFareAmount,
      surgeMultiplier,
      currency: normalizeCurrency(currency),
      paymentReference,
      pricingBreakdown,
      scheduledAt,
    });

    if (!rideRow) {
      throw createHttpError(500, "Failed to create ride record.");
    }

    const eventRow = await RideModel.insertRideEvent(dbClient, {
      rideId: rideRow.id,
      status: RideStatus.REQUESTED,
      actorType: normalizedActorType,
      actorId: actorId ?? null,
      payload: metadata ?? {},
    });

    await dbClient.query("COMMIT");

    const baseResult = {
      ride: RideModel.mapRideRow(rideRow),
      event: RideModel.mapEventRow(eventRow),
    };

    if (!autoAssign) {
      return baseResult;
    }

    try {
      const assignment = await assignDriver({
        rideId: rideRow.id,
        radiusMeters: autoAssignRadiusMeters,
        limit: autoAssignLimit,
        actorType: RideActorType.SYSTEM,
        actorId,
        allowNoCandidates: true,
      });

      return {
        ...baseResult,
        assignment,
      };
    } catch (assignmentError) {
      return {
        ...baseResult,
        assignment: null,
        assignmentError: assignmentError.message,
      };
    }
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}

async function assignDriver({
  rideId,
  driverId,
  radiusMeters = 5000,
  limit = 5,
  actorType,
  actorId,
  allowNoCandidates = false,
}) {
  if (!rideId) {
    throw createHttpError(400, "rideId is required to assign a driver.");
  }

  const normalizedActorType = normalizeActorType(actorType, RideActorType.SYSTEM);

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const rideRow = await RideModel.getRideByIdForUpdate(rideId, dbClient);

    if (!rideRow) {
      throw createHttpError(404, `Ride ${rideId} not found.`);
    }

    if (TERMINAL_RIDE_STATUSES.has(rideRow.status)) {
      throw createHttpError(
        409,
        `Ride is in terminal status "${rideRow.status}" and cannot be assigned.`
      );
    }

    let transitionResult = null;
    let workingRideRow = rideRow;

    if (rideRow.status === RideStatus.REQUESTED) {
      transitionResult = await transitionRide(dbClient, {
        rideId,
        toStatus: RideStatus.PENDING_DRIVER,
        actorType: RideActorType.SYSTEM,
        actorId,
        payload: { source: "assignment_queue" },
      });
      workingRideRow = await RideModel.getRideByIdForUpdate(rideId, dbClient);
    }

    if (workingRideRow.status !== RideStatus.PENDING_DRIVER) {
      throw createHttpError(
        409,
        `Ride status "${workingRideRow.status}" cannot transition to driver assignment queue.`
      );
    }

    const existingInvites = await RideModel.listDriverInvites(dbClient, rideId);
    const invitedDriverIds = existingInvites.map((invite) => invite.driverId);
    const newDriverIds = [];
    const invitedDriversDetails = [];

    if (driverId) {
      const driver = await DriverService.ensureDriverForUpdate(driverId, dbClient);

      if (driver.status !== "online") {
        throw createHttpError(409, "Selected driver is not available for assignment.");
      }

      const existingInvite = existingInvites.find(
        (invite) => invite.driverId === driverId
      );

      if (existingInvite && existingInvite.status === RideInviteStatus.ACCEPTED) {
        throw createHttpError(409, "Driver already accepted this ride.");
      }

      if (!existingInvite || existingInvite.status !== RideInviteStatus.PENDING) {
        newDriverIds.push(driverId);
      }

      invitedDriversDetails.push(driver);
    } else {
      const pickupPointWkt = locationToWkt(
        RideModel.mapRideRow(workingRideRow).pickupLocation
      );

      if (!pickupPointWkt) {
        throw createHttpError(400, "Ride does not have a valid pickup location.");
      }

      const candidates = await DriverService.findAvailableDriversNear(pickupPointWkt, {
        radiusMeters,
        limit,
        excludeDriverIds: invitedDriverIds,
        dbClient,
      });

      if (!candidates.length) {
        if (!allowNoCandidates) {
          throw createHttpError(404, "No available drivers found near pickup location.");
        }
      }

      candidates.forEach((candidate) => {
        newDriverIds.push(candidate.userId);
        invitedDriversDetails.push(candidate);
      });
    }

    const invites = newDriverIds.length
      ? await RideModel.insertDriverInvites(dbClient, rideId, newDriverIds)
      : [];

    let invitationEvent = null;
    if (newDriverIds.length) {
      invitationEvent = await RideModel.insertRideEvent(dbClient, {
        rideId,
        status: RideStatus.PENDING_DRIVER,
        actorType: normalizedActorType,
        actorId: actorId ?? null,
        payload: {
          invitedDrivers: newDriverIds,
        },
      });
    } else if (allowNoCandidates) {
      invitationEvent = await RideModel.insertRideEvent(dbClient, {
        rideId,
        status: RideStatus.PENDING_DRIVER,
        actorType: normalizedActorType,
        actorId: actorId ?? null,
        payload: {
          invitedDrivers: [],
          matchingAttempted: true,
          noCandidatesFound: true,
        },
      });
    }

    await dbClient.query("COMMIT");

    return {
      ride: transitionResult ? transitionResult.ride : RideModel.mapRideRow(workingRideRow),
      invites: invites.length
        ? invites
        : await RideModel.listDriverInvites(null, rideId, {
            statuses: [RideInviteStatus.PENDING],
          }),
      newlyInvitedDrivers: invitedDriversDetails,
      event: RideModel.mapEventRow(invitationEvent) ?? transitionResult?.event ?? null,
    };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}

async function respondDriverAssignment({
  rideId,
  driverId,
  action,
  actorType,
  actorId,
}) {
  if (!rideId) {
    throw createHttpError(400, "rideId is required.");
  }

  if (!driverId) {
    throw createHttpError(400, "driverId is required.");
  }

  const normalizedAction = String(action || "").toLowerCase();
  if (!["accept", "reject"].includes(normalizedAction)) {
    throw createHttpError(400, 'action must be "accept" or "reject".');
  }

  const normalizedActorType = normalizeActorType(actorType, RideActorType.DRIVER);

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const rideRow = await RideModel.getRideByIdForUpdate(rideId, dbClient);

    if (!rideRow) {
      throw createHttpError(404, `Ride ${rideId} not found.`);
    }

    if (rideRow.status !== RideStatus.PENDING_DRIVER) {
      throw createHttpError(
        409,
        `Ride is in status "${rideRow.status}" and cannot accept/reject invitation.`
      );
    }

    const invite = await RideModel.getDriverInvite(dbClient, rideId, driverId, {
      forUpdate: true,
    });

    if (!invite || invite.status !== RideInviteStatus.PENDING) {
      throw createHttpError(409, "Driver has no pending invitation for this ride.");
    }

    let result;

    if (normalizedAction === "accept") {
      result = await transitionRide(dbClient, {
        rideId,
        toStatus: RideStatus.DRIVER_ASSIGNED,
        actorType: normalizedActorType,
        actorId: actorId ?? driverId,
        driverId,
        payload: {
          response: "accepted",
        },
      });
    } else {
      await DriverService.ensureDriverForUpdate(driverId, dbClient);
      await RideModel.updateDriverInviteStatus(
        dbClient,
        rideId,
        driverId,
        RideInviteStatus.REJECTED
      );

      const eventRow = await RideModel.insertRideEvent(dbClient, {
        rideId,
        status: RideStatus.PENDING_DRIVER,
        actorType: normalizedActorType,
        actorId: actorId ?? driverId,
        payload: {
          driverId,
          response: "rejected",
        },
      });

      result = {
        ride: RideModel.mapRideRow(rideRow),
        event: RideModel.mapEventRow(eventRow),
      };
    }

    const pendingInvites = await RideModel.listDriverInvites(dbClient, rideId, {
      statuses: [RideInviteStatus.PENDING],
    });

    await dbClient.query("COMMIT");

    return {
      ride: result.ride,
      pendingInvites,
      event: result.event,
    };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}

async function driverProgress({
  rideId,
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
}) {
  if (!rideId) {
    throw createHttpError(400, "rideId is required.");
  }

  if (!driverId) {
    throw createHttpError(400, "driverId is required.");
  }

  if (!status || !isKnownStatus(status)) {
    throw createHttpError(400, `Invalid status "${status}".`);
  }

  const allowedStatuses = new Set([
    RideStatus.DRIVER_EN_ROUTE,
    RideStatus.DRIVER_ARRIVED,
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETED,
    RideStatus.CANCELED_BY_DRIVER,
  ]);

  if (!allowedStatuses.has(status)) {
    throw createHttpError(
      400,
      `Driver cannot transition ride to status "${status}".`
    );
  }

  const normalizedActorType = normalizeActorType(actorType, RideActorType.DRIVER);

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const result = await transitionRide(dbClient, {
      rideId,
      toStatus: status,
      actorType: normalizedActorType,
      actorId: actorId ?? driverId,
      driverId,
      payload,
      cancellationReason,
      actualDistanceMeters,
      actualDurationSeconds,
      finalFareAmount,
      paymentReference: normalizePaymentReference(paymentReference),
      surgeMultiplier,
      pricingBreakdown,
    });

    await dbClient.query("COMMIT");
    return result;
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}

async function updateRideStatus({
  rideId,
  nextStatus,
  actorType,
  actorId,
  payload,
  driverId,
  cancellationReason,
  actualDistanceMeters,
  actualDurationSeconds,
  finalFareAmount,
  paymentReference,
  surgeMultiplier,
  pricingBreakdown,
}) {
  if (!rideId) {
    throw createHttpError(400, "rideId is required.");
  }

  if (!nextStatus || !isKnownStatus(nextStatus)) {
    throw createHttpError(400, `Invalid nextStatus "${nextStatus}".`);
  }

  const normalizedActorType = normalizeActorType(actorType);

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const result = await transitionRide(dbClient, {
      rideId,
      toStatus: nextStatus,
      actorType: normalizedActorType,
      actorId,
      driverId,
      payload,
      cancellationReason,
      actualDistanceMeters,
      actualDurationSeconds,
      finalFareAmount,
      paymentReference,
      surgeMultiplier,
      pricingBreakdown,
    });
    await dbClient.query("COMMIT");
    return {
      ...result,
      statusChanged: true,
    };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
}

async function cancelRide({
  rideId,
  actorType,
  actorId,
  cancellationReason,
  payload,
}) {
  const normalizedActorType = normalizeActorType(actorType);
  const nextStatus =
    normalizedActorType === RideActorType.CLIENT
      ? RideStatus.CANCELED_BY_CLIENT
      : normalizedActorType === RideActorType.DRIVER
      ? RideStatus.CANCELED_BY_DRIVER
      : RideStatus.CANCELED_BY_SYSTEM;

  return updateRideStatus({
    rideId,
    nextStatus,
    actorType: normalizedActorType,
    actorId,
    cancellationReason,
    payload,
  });
}

async function markNoShow({
  rideId,
  actorType,
  actorId,
  driverId,
  payload,
  cancellationReason = "rider_no_show",
}) {
  return updateRideStatus({
    rideId,
    nextStatus: RideStatus.NO_SHOW,
    actorType,
    actorId,
    driverId,
    payload,
    cancellationReason,
  });
}

async function requeueRide({
  rideId,
  actorType,
  actorId,
  payload,
}) {
  return updateRideStatus({
    rideId,
    nextStatus: RideStatus.PENDING_DRIVER,
    actorType,
    actorId,
    payload,
  });
}

async function systemCancelRide({
  rideId,
  actorId,
  payload,
  cancellationReason = "system_cancel",
}) {
  return updateRideStatus({
    rideId,
    nextStatus: RideStatus.CANCELED_BY_SYSTEM,
    actorType: RideActorType.SYSTEM,
    actorId,
    payload,
    cancellationReason,
  });
}

async function listRides(filters = {}, viewer = null) {
  const normalizedFilters = { ...filters };

  if (viewer?.role === "client") {
    normalizedFilters.clientId = viewer.id;
  }

  if (viewer?.role === "driver") {
    normalizedFilters.driverId = viewer.id;
  }

  if (normalizedFilters.limit !== undefined) {
    normalizedFilters.limit = Number(normalizedFilters.limit);
  }

  if (normalizedFilters.offset !== undefined) {
    normalizedFilters.offset = Number(normalizedFilters.offset);
  }

  if (normalizedFilters.includePassenger !== undefined) {
    const includePassengerRaw = String(normalizedFilters.includePassenger).toLowerCase();
    normalizedFilters.includePassenger = ["1", "true", "yes"].includes(includePassengerRaw);
  }

  const rows = await RideModel.listRides(normalizedFilters);
  return {
    rides: rows.map(RideModel.mapRideRow),
  };
}

async function listDriverInvites(filters = {}, viewer = null) {
  const role = String(viewer?.role || "").toLowerCase();
  const normalizedFilters = { ...filters };

  let resolvedDriverId = normalizedFilters.driverId;
  if (role === "driver") {
    resolvedDriverId = viewer.id;
  }

  if (!resolvedDriverId) {
    throw createHttpError(400, "driverId is required for this query.");
  }

  let statuses;
  if (normalizedFilters.statuses) {
    statuses = String(normalizedFilters.statuses)
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    const invalidStatuses = statuses.filter(
      (status) => !RIDE_INVITE_STATUS_VALUES.includes(status)
    );

    if (invalidStatuses.length > 0) {
      throw createHttpError(
        400,
        `Invalid invite status value(s): ${invalidStatuses.join(", ")}.`
      );
    }
  } else {
    statuses = [RideInviteStatus.PENDING];
  }

  const limit = normalizedFilters.limit !== undefined
    ? Number(normalizedFilters.limit)
    : 25;
  const offset = normalizedFilters.offset !== undefined
    ? Number(normalizedFilters.offset)
    : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw createHttpError(400, "limit must be an integer between 1 and 200.");
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw createHttpError(400, "offset must be a non-negative integer.");
  }

  const rows = await RideModel.listDriverInvitesForDriver({
    driverId: resolvedDriverId,
    statuses,
    limit,
    offset,
  });

  return {
    invites: rows.map((row) => ({
      ...row.invite,
      ride: row.ride,
    })),
  };
}

async function getRideById(rideId, { includeEvents = false, eventsLimit = 50 } = {}) {
  if (!rideId) {
    throw createHttpError(400, "rideId is required.");
  }

  const rideRow = await RideModel.getRideById(rideId);

  if (!rideRow) {
    throw createHttpError(404, `Ride ${rideId} not found.`);
  }

  const ride = RideModel.mapRideRow(rideRow);

  if (!includeEvents) {
    return { ride, events: [] };
  }

  const eventRows = await RideModel.listRideEvents(
    rideId,
    { limit: eventsLimit },
    null
  );

  return {
    ride,
    events: eventRows.map(RideModel.mapEventRow),
  };
}

module.exports = {
  createRide,
  assignDriver,
  respondDriverAssignment,
  driverProgress,
  updateRideStatus,
  cancelRide,
  markNoShow,
  requeueRide,
  systemCancelRide,
  listRides,
  getRideById,
  listDriverInvites,
  __private: {
    buildTransitionPlan,
    validateTransitionPayload,
    normalizeActorType,
  },
};
