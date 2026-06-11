const RideModel = require("../models/ride.model");
const { RideActorType } = require("../constants/ride-status");
const { env } = require("../../../config");

const DEFAULT_MATCH_LIMIT = 10;

function locationToWkt(location) {
  if (!location) {
    return null;
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return `SRID=4326;POINT(${lng} ${lat})`;
}

function shouldIgnoreAssignmentError(error) {
  const status = Number(error?.status);
  return [404, 409].includes(status);
}

async function matchPendingRidesForDriver(driver, {
  radiusMeters = env.matching.driverRequestSearchRadiusMeters,
  limit = DEFAULT_MATCH_LIMIT,
  actorId = null,
} = {}) {
  if (!driver?.userId || driver.status !== "online") {
    return {
      matched: 0,
      invites: [],
      skipped: true,
      reason: "driver_not_online",
    };
  }

  const driverLocationWkt = locationToWkt(driver.currentLocation);
  if (!driverLocationWkt) {
    return {
      matched: 0,
      invites: [],
      skipped: true,
      reason: "driver_location_missing",
    };
  }

  const candidateRows = await RideModel.listPendingRidesNearDriver({
    driverId: driver.userId,
    driverLocationWkt,
    radiusMeters,
    limit,
  });

  const RideService = require("./ride.service");
  const invites = [];
  const errors = [];

  for (const rideRow of candidateRows) {
    try {
      const result = await RideService.assignDriver({
        rideId: rideRow.id,
        driverId: driver.userId,
        actorType: RideActorType.SYSTEM,
        actorId,
        allowNoCandidates: true,
      });

      invites.push(...(result.invites || []));
    } catch (error) {
      if (!shouldIgnoreAssignmentError(error)) {
        errors.push({
          rideId: rideRow.id,
          message: error.message,
          status: error.status || null,
        });
      }
    }
  }

  return {
    matched: invites.length,
    invites,
    errors,
  };
}

module.exports = {
  matchPendingRidesForDriver,
  __private: {
    locationToWkt,
    shouldIgnoreAssignmentError,
  },
};
