const test = require("node:test");
const assert = require("node:assert/strict");

const RideService = require("../src/modules/rides/services/ride.service");
const SettingsService = require("../src/modules/settings/services/settings.service");
const {
  RideStatus,
  RideActorType,
} = require("../src/modules/rides/constants/ride-status");
const {
  assertTransitionAllowed,
} = require("../src/modules/rides/utils/ride-state-machine");

const {
  buildTransitionPlan,
  getClientDriverSearchRadiusMeters,
  isActiveRideUniqueViolation,
  validateTransitionPayload,
} = RideService.__private;

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

test("active ride unique index violations are treated as business conflicts", () => {
  assert.equal(
    isActiveRideUniqueViolation({
      code: "23505",
      constraint: "rides_one_active_per_client_idx",
    }),
    true
  );

  assert.equal(
    isActiveRideUniqueViolation({
      code: "23505",
      constraint: "rides_payment_reference_unique",
    }),
    false
  );
});

test("same-status transitions are audit no-ops", async () => {
  const rideRow = buildRideRow({
    id: "ride-1",
    status: RideStatus.DRIVER_EN_ROUTE,
  });
  const calls = [];
  const dbClient = {
    async query(sql) {
      calls.push(sql);
      return { rows: [rideRow] };
    },
  };

  const result = await RideService.__private.transitionRide(dbClient, {
    rideId: "ride-1",
    toStatus: RideStatus.DRIVER_EN_ROUTE,
    actorType: RideActorType.DRIVER,
    actorId: "driver-1",
    driverId: "driver-1",
  });

  assert.equal(result.statusChanged, false);
  assert.equal(result.idempotent, true);
  assert.equal(result.event, null);
  assert.equal(
    calls.some((sql) => String(sql).includes("INSERT INTO ride_events")),
    false
  );
});

test("client driver search radius uses database setting as source of truth", async () => {
  const originalGetSetting = SettingsService.getSetting;
  const calls = [];

  SettingsService.getSetting = async (key) => {
    calls.push(key);
    return { value: "2000" };
  };

  try {
    const radiusMeters = await getClientDriverSearchRadiusMeters();

    assert.equal(radiusMeters, 2000);
    assert.deepEqual(calls, [RideService.__private.CLIENT_DRIVER_SEARCH_RADIUS_SETTING]);
  } finally {
    SettingsService.getSetting = originalGetSetting;
  }
});

test("client driver search radius rejects invalid database setting", async () => {
  const originalGetSetting = SettingsService.getSetting;

  SettingsService.getSetting = async () => ({ value: "0" });

  try {
    await assert.rejects(
      () => getClientDriverSearchRadiusMeters(),
      (error) =>
        error.status === 500 &&
        /client driver search radius/.test(error.message)
    );
  } finally {
    SettingsService.getSetting = originalGetSetting;
  }
});
