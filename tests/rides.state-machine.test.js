const test = require("node:test");
const assert = require("node:assert/strict");

const RideService = require("../src/modules/rides/services/ride.service");
const {
  RideStatus,
  RideActorType,
} = require("../src/modules/rides/constants/ride-status");
const {
  assertTransitionAllowed,
} = require("../src/modules/rides/utils/ride-state-machine");

const { buildTransitionPlan, validateTransitionPayload } = RideService.__private;

function buildRideRow(overrides = {}) {
  return {
    status: RideStatus.PENDING_DRIVER,
    driver_id: null,
    accepted_at: null,
    driver_arrived_at: null,
    started_at: null,
    completed_at: null,
    canceled_at: null,
    ...overrides,
  };
}

test("state machine allows canonical happy path", () => {
  assert.doesNotThrow(() =>
    assertTransitionAllowed({
      fromStatus: RideStatus.REQUESTED,
      toStatus: RideStatus.PENDING_DRIVER,
      actorType: RideActorType.SYSTEM,
    })
  );

  assert.doesNotThrow(() =>
    assertTransitionAllowed({
      fromStatus: RideStatus.PENDING_DRIVER,
      toStatus: RideStatus.DRIVER_ASSIGNED,
      actorType: RideActorType.DRIVER,
    })
  );

  assert.doesNotThrow(() =>
    assertTransitionAllowed({
      fromStatus: RideStatus.DRIVER_ASSIGNED,
      toStatus: RideStatus.DRIVER_EN_ROUTE,
      actorType: RideActorType.DRIVER,
    })
  );
});

test("buildTransitionPlan requires a driver for driver_assigned", () => {
  assert.throws(
    () =>
      buildTransitionPlan(buildRideRow(), {
        toStatus: RideStatus.DRIVER_ASSIGNED,
        actorType: RideActorType.DRIVER,
      }),
    /driverId is required/
  );
});

test("buildTransitionPlan maps driver_assigned into ride update fields", () => {
  const plan = buildTransitionPlan(buildRideRow(), {
    toStatus: RideStatus.DRIVER_ASSIGNED,
    actorType: RideActorType.DRIVER,
    driverId: "driver-1",
  });

  assert.equal(plan.resolvedDriverId, "driver-1");
  assert.equal(plan.updateFields.status, RideStatus.DRIVER_ASSIGNED);
  assert.equal(plan.updateFields.driver_id, "driver-1");
  assert.ok(plan.expressions.includes("accepted_at = NOW()"));
});

test("completed rides require final metrics", () => {
  assert.throws(
    () =>
      validateTransitionPayload({
        currentRow: buildRideRow({
          status: RideStatus.IN_PROGRESS,
          driver_id: "driver-1",
        }),
        toStatus: RideStatus.COMPLETED,
        actorType: RideActorType.DRIVER,
        driverId: "driver-1",
      }),
    /actualDistanceMeters/
  );
});

test("pending_driver clears assigned driver", () => {
  const plan = buildTransitionPlan(
    buildRideRow({
      status: RideStatus.DRIVER_ASSIGNED,
      driver_id: "driver-1",
    }),
    {
      toStatus: RideStatus.PENDING_DRIVER,
      actorType: RideActorType.SYSTEM,
    }
  );

  assert.equal(plan.updateFields.status, RideStatus.PENDING_DRIVER);
  assert.equal(plan.updateFields.driver_id, null);
});
