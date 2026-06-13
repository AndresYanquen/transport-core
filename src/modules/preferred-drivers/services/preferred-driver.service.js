const PreferredDriverModel = require("../models/preferred-driver.model");

function buildError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function listPreferredDrivers(user, options) {
  const preferredDrivers = await PreferredDriverModel.listByUserId(user.id, options);
  return { preferredDrivers };
}

async function addPreferredDriver(user, driverId) {
  const driverExists = await PreferredDriverModel.driverExists(driverId);

  if (!driverExists) {
    throw buildError(404, "Driver was not found.");
  }

  const lastRideAt = await PreferredDriverModel.userCompletedRideWithDriver(
    user.id,
    driverId
  );

  if (!lastRideAt) {
    throw buildError(
      403,
      "Users can only prefer drivers from their completed ride history."
    );
  }

  try {
    await PreferredDriverModel.createForUser(user.id, driverId, { lastRideAt });
  } catch (error) {
    if (error?.code === "23505") {
      await PreferredDriverModel.markUsedForUser(user.id, driverId, { lastRideAt });
    } else {
      throw error;
    }
  }

  const preferredDriver = await PreferredDriverModel.findByDriverForUser(
    user.id,
    driverId
  );

  return { preferredDriver };
}

async function getPreferredDriver(user, driverId) {
  const preferredDriver = await PreferredDriverModel.findByDriverForUser(
    user.id,
    driverId
  );

  if (!preferredDriver) {
    throw buildError(404, "Preferred driver was not found.");
  }

  return { preferredDriver };
}

async function removePreferredDriver(user, driverId) {
  const deleted = await PreferredDriverModel.softDeleteForUser(user.id, driverId);

  if (!deleted) {
    throw buildError(404, "Preferred driver was not found.");
  }

  return { deleted: true };
}

module.exports = {
  listPreferredDrivers,
  addPreferredDriver,
  getPreferredDriver,
  removePreferredDriver,
};
