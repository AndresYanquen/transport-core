const DriverModel = require("../models/driver.model");
const RideModel = require("../../rides/models/ride.model");
const { emitToRide, emitToRole, emitToUser } = require("../../../realtime/socket.server");

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

  const adminPayload = buildDriverRealtimePayload(driver);
  safeRealtimeEmit(() => emitToRole("admin", "admin:driver-location-updated", adminPayload));

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

function buildDriverRealtimePayload(driver) {
  return {
    driver: {
      userId: driver.userId,
      status: driver.status,
      availabilityIntent: driver.availabilityIntent,
      lastSeenAt: driver.lastSeenAt,
      offlineReason: driver.offlineReason,
      updatedAt: driver.updatedAt || new Date().toISOString(),
      currentLocation: driver.currentLocation ?? null,
      headingDegrees: driver.headingDegrees ?? null,
      speedKmh: driver.speedKmh ?? null,
      vehicle: {
        make: driver.vehicleMake,
        model: driver.vehicleModel,
        year: driver.vehicleYear,
        color: driver.vehicleColor,
        plate: driver.vehiclePlate,
        type: driver.vehicleType,
      },
      serviceTypes: driver.serviceTypes || [],
      contact: driver.contact || {},
    },
    emittedAt: new Date().toISOString(),
  };
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

async function updateLocation(driverId, { currentLocationWkt, heading, speedKmh, hasLocation }) {
  await ensureDriver(driverId);

  const driver = await DriverModel.updateLocation(driverId, {
    currentLocationWkt,
    heading,
    speedKmh,
    hasLocation,
  });

  if (!driver) {
    throw createHttpError(500, "Failed to update driver location.");
  }

  if (hasLocation) {
    await emitDriverLocationUpdated(driver);
  }
  if (driver.status === "online") {
    await matchPendingRidesForDriverBestEffort(driver);
  }

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

  safeRealtimeEmit(() =>
    emitToRole("admin", "admin:driver-status-updated", buildDriverRealtimePayload(driver))
  );

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

  safeRealtimeEmit(() =>
    emitToRole("admin", "admin:driver-status-updated", buildDriverRealtimePayload(driver))
  );

  return driver;
}

async function restoreDriverAvailability(driverId, dbClient) {
  const driver = await DriverModel.restoreAvailability(driverId, dbClient);
  if (!driver) {
    throw createHttpError(500, "Failed to restore driver availability.");
  }
  safeRealtimeEmit(() =>
    emitToRole("admin", "admin:driver-status-updated", buildDriverRealtimePayload(driver))
  );
  return driver;
}

async function expireStaleOnlineDrivers() {
  const driverIds = await DriverModel.expireStaleOnlineDrivers();
  for (const driverId of driverIds) {
    const driver = await DriverModel.getDriverById(driverId);
    if (driver) {
      safeRealtimeEmit(() =>
        emitToRole("admin", "admin:driver-status-updated", buildDriverRealtimePayload(driver))
      );
    }
  }
  return driverIds;
}

async function listServiceTypes(driverId) {
  await ensureDriver(driverId);
  return {
    serviceTypes: await DriverModel.listServiceTypes(driverId),
  };
}

async function replaceServiceTypes(driverId, serviceTypeCodes) {
  await ensureDriver(driverId);
  return {
    serviceTypes: await DriverModel.replaceServiceTypes(driverId, serviceTypeCodes),
  };
}

module.exports = {
  updateLocation,
  updateStatus,
  findAvailableDriversNear,
  ensureDriverForUpdate,
  setDriverStatus,
  restoreDriverAvailability,
  expireStaleOnlineDrivers,
  listServiceTypes,
  replaceServiceTypes,
};
