const RideStatus = Object.freeze({
  REQUESTED: "requested",
  PENDING_DRIVER: "pending_driver",
  DRIVER_ASSIGNED: "driver_assigned",
  DRIVER_EN_ROUTE: "driver_en_route",
  DRIVER_ARRIVED: "driver_arrived",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELED_BY_CLIENT: "canceled_by_client",
  CANCELED_BY_DRIVER: "canceled_by_driver",
  CANCELED_BY_SYSTEM: "canceled_by_system",
  NO_SHOW: "no_show",
});

const RideActorType = Object.freeze({
  CLIENT: "client",
  DRIVER: "driver",
  SYSTEM: "system",
  SUPPORT: "support",
});

const TERMINAL_RIDE_STATUSES = new Set([
  RideStatus.COMPLETED,
  RideStatus.CANCELED_BY_CLIENT,
  RideStatus.CANCELED_BY_DRIVER,
  RideStatus.CANCELED_BY_SYSTEM,
  RideStatus.NO_SHOW,
]);

const RIDE_STATUS_VALUES = Object.values(RideStatus);
const RIDE_ACTOR_TYPES = Object.values(RideActorType);

module.exports = {
  RideStatus,
  RideActorType,
  RIDE_STATUS_VALUES,
  RIDE_ACTOR_TYPES,
  TERMINAL_RIDE_STATUSES,
};
