const DriverModel = require("../models/driver.model");

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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

  return driver;
}

async function updateStatus(driverId, status) {
  await ensureDriver(driverId);

  const driver = await DriverModel.updateStatus(driverId, status);

  if (!driver) {
    throw createHttpError(500, "Failed to update driver status.");
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
