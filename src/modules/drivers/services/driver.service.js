const DriverModel = require("../models/driver.model");
const RideModel = require("../../rides/models/ride.model");
const { emitToRide, emitToUser } = require("../../../realtime/socket.server");

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeRealtimeEmit(executor) {
  try {
    executor();
  } catch (error) {
    console.error("Realtime emit failed:", error);
  }
}

async function emitDriverLocationUpdated(driver) {
  if (!driver?.userId) {
    return;
  }

  const rideRows = await RideModel.listActiveRidesByDriverId(driver.userId);
  if (!rideRows.length) {
    return;
  }

  const emittedAt = new Date().toISOString();

  for (const rideRow of rideRows) {
    const payload = {
      rideId: rideRow.id,
      driverId: driver.userId,
      currentLocation: driver.currentLocation ?? { lat: null, lng: null },
      headingDegrees: driver.headingDegrees ?? null,
      speedKmh: driver.speedKmh ?? null,
      emittedAt,
    };

    if (rideRow.client_id) {
      safeRealtimeEmit(() =>
        emitToUser(rideRow.client_id, "ride:driver-location-updated", payload)
      );
    }
    if (rideRow.driver_id) {
      safeRealtimeEmit(() =>
        emitToUser(rideRow.driver_id, "ride:driver-location-updated", payload)
      );
    }

    safeRealtimeEmit(() =>
      emitToRide(rideRow.id, "ride:driver-location-updated", {
        rideId: rideRow.id,
        driverId: driver.userId,
        emittedAt,
      })
    );
  }
}

async function matchPendingRidesForDriverBestEffort(driver) {
  try {
    const RideMatchingService = require("../../rides/services/ride-matching.service");
    return await RideMatchingService.matchPendingRidesForDriver(driver);
  } catch (error) {
    console.error("Driver matching failed:", error);
    return {
      matched: 0,
      invites: [],
      errors: [{ message: error.message }],
    };
  }
}

async function ensureDriver(driverId, { forUpdate = false, dbClient } = {}) {
  const driver = await DriverModel.getDriverById(driverId, {
    forUpdate,
    dbClient,
  });

  if (!driver) {
    throw createHttpError(404, "Driver not found.");
  }

  return driver;
}

async function updateLocation(driverId, { currentLocationWkt, heading, speedKmh }) {
  await ensureDriver(driverId);

  const driver = await DriverModel.updateLocation(driverId, {
    currentLocationWkt,
    heading,
    speedKmh,
  });

  if (!driver) {
    throw createHttpError(500, "Failed to update driver location.");
  }

  await emitDriverLocationUpdated(driver);
  await matchPendingRidesForDriverBestEffort(driver);

  return driver;
}

async function updateStatus(driverId, status) {
  await ensureDriver(driverId);

  const driver = await DriverModel.updateStatus(driverId, status);

  if (!driver) {
    throw createHttpError(500, "Failed to update driver status.");
  }

  if (driver.status === "online") {
    await matchPendingRidesForDriverBestEffort(driver);
  }

  return driver;
}

async function findAvailableDriversNear(pointWkt, options) {
  return DriverModel.findAvailableDriversNear(pointWkt, options);
}

async function ensureDriverForUpdate(driverId, dbClient) {
  return ensureDriver(driverId, { forUpdate: true, dbClient });
}

async function setDriverStatus(driverId, status, dbClient) {
  const driver = await DriverModel.updateStatus(driverId, status, dbClient);
  if (!driver) {
    throw createHttpError(500, "Failed to update driver status.");
  }

  return driver;
}

module.exports = {
  updateLocation,
  updateStatus,
  findAvailableDriversNear,
  ensureDriverForUpdate,
  setDriverStatus,
};
