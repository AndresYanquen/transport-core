const RideModel = require("../models/ride.model");
const DriverService = require("../../drivers/services/driver.service");
const { RideStatus } = require("../constants/ride-status");
const { RideInviteStatus } = require("../constants/ride-invite-status");

async function applyDriverAssignedEffects(dbClient, {
  rideId,
  driverId,
}) {
  await DriverService.ensureDriverForUpdate(driverId, dbClient);
  await RideModel.updateDriverInviteStatus(
    dbClient,
    rideId,
    driverId,
    RideInviteStatus.ACCEPTED
  );
  await RideModel.expirePendingInvitesExcept(dbClient, rideId, driverId);
  await DriverService.setDriverStatus(driverId, "busy", dbClient);
}

async function applyPendingDriverEffects(dbClient, {
  rideId,
  previousDriverId,
}) {
  if (previousDriverId) {
    await DriverService.setDriverStatus(previousDriverId, "online", dbClient);
  }

  await RideModel.expireAllPendingInvites(dbClient, rideId);
}

async function applyTerminalRideEffects(dbClient, {
  rideId,
  driverId,
}) {
  if (driverId) {
    await DriverService.setDriverStatus(driverId, "online", dbClient);
  }

  await RideModel.expireAllPendingInvites(dbClient, rideId);
}

function isTerminalStatus(status) {
  return [
    RideStatus.COMPLETED,
    RideStatus.CANCELED_BY_CLIENT,
    RideStatus.CANCELED_BY_DRIVER,
    RideStatus.CANCELED_BY_SYSTEM,
    RideStatus.NO_SHOW,
  ].includes(status);
}

async function applyTransitionSideEffects(dbClient, context) {
  const {
    rideId,
    fromStatus,
    toStatus,
    driverId,
    previousDriverId,
  } = context;

  if (toStatus === RideStatus.DRIVER_ASSIGNED) {
    await applyDriverAssignedEffects(dbClient, {
      rideId,
      driverId,
    });
    return;
  }

  if (toStatus === RideStatus.PENDING_DRIVER) {
    await applyPendingDriverEffects(dbClient, {
      rideId,
      previousDriverId: previousDriverId || null,
    });
    return;
  }

  if (isTerminalStatus(toStatus)) {
    await applyTerminalRideEffects(dbClient, {
      rideId,
      driverId: driverId || previousDriverId || null,
    });
    return;
  }

  if (
    fromStatus === RideStatus.DRIVER_ASSIGNED &&
    toStatus === RideStatus.DRIVER_EN_ROUTE &&
    driverId
  ) {
    await DriverService.setDriverStatus(driverId, "busy", dbClient);
  }
}

module.exports = {
  applyTransitionSideEffects,
};
