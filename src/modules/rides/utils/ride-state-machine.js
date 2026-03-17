const {
  RideStatus,
  RideActorType,
  RIDE_STATUS_VALUES,
  RIDE_ACTOR_TYPES,
  TERMINAL_RIDE_STATUSES,
} = require("../constants/ride-status");

const stateTransitions = Object.freeze({
  [RideStatus.REQUESTED]: {
    [RideStatus.PENDING_DRIVER]: [RideActorType.SYSTEM],
    [RideStatus.CANCELED_BY_CLIENT]: [RideActorType.CLIENT],
    [RideStatus.CANCELED_BY_SYSTEM]: [RideActorType.SYSTEM],
  },
  [RideStatus.PENDING_DRIVER]: {
    [RideStatus.DRIVER_ASSIGNED]: [RideActorType.SYSTEM, RideActorType.DRIVER],
    [RideStatus.CANCELED_BY_CLIENT]: [RideActorType.CLIENT],
    [RideStatus.CANCELED_BY_SYSTEM]: [RideActorType.SYSTEM],
  },
  [RideStatus.DRIVER_ASSIGNED]: {
    [RideStatus.DRIVER_EN_ROUTE]: [RideActorType.DRIVER],
    [RideStatus.PENDING_DRIVER]: [RideActorType.SYSTEM],
    [RideStatus.CANCELED_BY_CLIENT]: [RideActorType.CLIENT],
    [RideStatus.CANCELED_BY_DRIVER]: [RideActorType.DRIVER],
    [RideStatus.CANCELED_BY_SYSTEM]: [RideActorType.SYSTEM],
  },
  [RideStatus.DRIVER_EN_ROUTE]: {
    [RideStatus.DRIVER_ARRIVED]: [RideActorType.DRIVER],
    [RideStatus.CANCELED_BY_CLIENT]: [RideActorType.CLIENT],
    [RideStatus.CANCELED_BY_DRIVER]: [RideActorType.DRIVER],
    [RideStatus.CANCELED_BY_SYSTEM]: [RideActorType.SYSTEM],
  },
  [RideStatus.DRIVER_ARRIVED]: {
    [RideStatus.IN_PROGRESS]: [RideActorType.DRIVER],
    [RideStatus.CANCELED_BY_CLIENT]: [RideActorType.CLIENT],
    [RideStatus.CANCELED_BY_DRIVER]: [RideActorType.DRIVER],
    [RideStatus.NO_SHOW]: [RideActorType.SYSTEM, RideActorType.DRIVER],
    [RideStatus.CANCELED_BY_SYSTEM]: [RideActorType.SYSTEM],
  },
  [RideStatus.IN_PROGRESS]: {
    [RideStatus.COMPLETED]: [RideActorType.DRIVER, RideActorType.SYSTEM],
    [RideStatus.CANCELED_BY_CLIENT]: [RideActorType.CLIENT],
    [RideStatus.CANCELED_BY_DRIVER]: [RideActorType.DRIVER],
    [RideStatus.CANCELED_BY_SYSTEM]: [RideActorType.SYSTEM],
  },
});

function isKnownStatus(status) {
  return RIDE_STATUS_VALUES.includes(status);
}

function isKnownActorType(actorType) {
  return RIDE_ACTOR_TYPES.includes(actorType);
}

function getAllowedTransitions(fromStatus) {
  return stateTransitions[fromStatus] ?? {};
}

function getPermittedActors(fromStatus, toStatus) {
  const transitions = getAllowedTransitions(fromStatus);
  return transitions[toStatus] ?? [];
}

function isTransitionAllowed(fromStatus, toStatus, actorType) {
  if (!isKnownStatus(fromStatus) || !isKnownStatus(toStatus)) {
    return false;
  }

  if (fromStatus === toStatus) {
    return true;
  }

  if (TERMINAL_RIDE_STATUSES.has(fromStatus)) {
    return false;
  }

  const allowedActors = getPermittedActors(fromStatus, toStatus);

  if (allowedActors.length === 0) {
    return false;
  }

  if (actorType && !isKnownActorType(actorType)) {
    return false;
  }

  if (!actorType) {
    return true;
  }

  return allowedActors.includes(actorType);
}

function assertTransitionAllowed({ fromStatus, toStatus, actorType }) {
  if (!isKnownStatus(toStatus)) {
    const error = new Error(`Unknown ride status: ${toStatus}`);
    error.status = 400;
    throw error;
  }

  if (!isKnownStatus(fromStatus)) {
    const error = new Error(`Unknown current ride status: ${fromStatus}`);
    error.status = 500;
    throw error;
  }

  if (fromStatus === toStatus) {
    return;
  }

  if (!isTransitionAllowed(fromStatus, toStatus, actorType)) {
    const permittedActors = getPermittedActors(fromStatus, toStatus);

    const detail =
      permittedActors.length > 0
        ? `Allowed actors: ${permittedActors.join(", ")}.`
        : "No transition defined.";

    const error = new Error(
      `Transition from ${fromStatus} to ${toStatus} is not permitted for actor ${actorType}. ${detail}`
    );
    error.status = 409;
    throw error;
  }
}

module.exports = {
  stateTransitions,
  isKnownStatus,
  isKnownActorType,
  getAllowedTransitions,
  getPermittedActors,
  isTransitionAllowed,
  assertTransitionAllowed,
};
