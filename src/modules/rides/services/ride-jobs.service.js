const RideModel = require("../models/ride.model");
const { RideActorType, RideStatus } = require("../constants/ride-status");
const RideService = require("./ride.service");

function subtractSeconds(date, seconds) {
  return new Date(date.getTime() - seconds * 1000);
}

async function processRideTimeouts({
  now = new Date(),
  pendingDriverTimeoutSeconds = 90,
  driverAssignedTimeoutSeconds = 45,
  driverArrivedTimeoutSeconds = 300,
  actorId = null,
} = {}) {
  const pendingDriverBefore = subtractSeconds(now, pendingDriverTimeoutSeconds);
  const driverAssignedBefore = subtractSeconds(now, driverAssignedTimeoutSeconds);
  const driverArrivedBefore = subtractSeconds(now, driverArrivedTimeoutSeconds);

  const [
    pendingDriverRides,
    driverAssignedRides,
    driverArrivedRides,
  ] = await Promise.all([
    RideModel.listPendingDriverTimeoutCandidates(pendingDriverBefore),
    RideModel.listDriverAssignedTimeoutCandidates(driverAssignedBefore),
    RideModel.listDriverArrivedNoShowCandidates(driverArrivedBefore),
  ]);

  const results = [];

  for (const ride of pendingDriverRides) {
    const retryResult = await RideService.assignDriver({
      rideId: ride.id,
      actorType: RideActorType.SYSTEM,
      actorId,
      allowNoCandidates: true,
    });

    if (retryResult.invites && retryResult.invites.length > 0) {
      results.push({
        action: "pending_driver_retry",
        ride: retryResult.ride,
        invitesCount: retryResult.invites.length,
        event: retryResult.event,
      });
      continue;
    }

    results.push(
      await RideService.systemCancelRide({
        rideId: ride.id,
        actorId,
        payload: {
          source: "timeout_job",
          timedOutStatus: RideStatus.PENDING_DRIVER,
          matchingRetried: true,
        },
        cancellationReason: "no_driver_accepted_in_time",
      })
    );
  }

  for (const ride of driverAssignedRides) {
    results.push(
      await RideService.requeueRide({
        rideId: ride.id,
        actorType: RideActorType.SYSTEM,
        actorId,
        payload: { source: "timeout_job", timedOutStatus: RideStatus.DRIVER_ASSIGNED },
      })
    );
  }

  for (const ride of driverArrivedRides) {
    results.push(
      await RideService.markNoShow({
        rideId: ride.id,
        actorType: RideActorType.SYSTEM,
        actorId,
        driverId: ride.driver_id,
        payload: { source: "timeout_job", timedOutStatus: RideStatus.DRIVER_ARRIVED },
        cancellationReason: "rider_no_show_timeout",
      })
    );
  }

  return {
    processed: results.length,
    results,
  };
}

module.exports = {
  processRideTimeouts,
};
