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
  canViewRide,
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
        actorId: "driver-1",
        driverId: "driver-1",
      }),
    /actualDistanceMeters/
  );
});

test("client actors can only transition their own rides", () => {
  assert.throws(
    () =>
      validateTransitionPayload({
        currentRow: buildRideRow({
          status: RideStatus.PENDING_DRIVER,
          client_id: "client-1",
        }),
        toStatus: RideStatus.CANCELED_BY_CLIENT,
        actorType: RideActorType.CLIENT,
        actorId: "client-2",
      }),
    /own rides/
  );

  assert.doesNotThrow(() =>
    validateTransitionPayload({
      currentRow: buildRideRow({
        status: RideStatus.PENDING_DRIVER,
        client_id: "client-1",
      }),
      toStatus: RideStatus.CANCELED_BY_CLIENT,
      actorType: RideActorType.CLIENT,
      actorId: "client-1",
    })
  );
});

test("driver actors can only transition assigned rides after assignment", () => {
  assert.throws(
    () =>
      validateTransitionPayload({
        currentRow: buildRideRow({
          status: RideStatus.DRIVER_ASSIGNED,
          driver_id: "driver-1",
        }),
        toStatus: RideStatus.DRIVER_EN_ROUTE,
        actorType: RideActorType.DRIVER,
        actorId: "driver-2",
        driverId: "driver-2",
      }),
    /assigned to them/
  );

  assert.doesNotThrow(() =>
    validateTransitionPayload({
      currentRow: buildRideRow({
        status: RideStatus.DRIVER_ASSIGNED,
        driver_id: "driver-1",
      }),
      toStatus: RideStatus.DRIVER_EN_ROUTE,
      actorType: RideActorType.DRIVER,
      actorId: "driver-1",
      driverId: "driver-1",
    })
  );
});

test("driver actors can accept a pending invite before assignment", () => {
  assert.doesNotThrow(() =>
    validateTransitionPayload({
      currentRow: buildRideRow({
        status: RideStatus.PENDING_DRIVER,
        driver_id: null,
      }),
      toStatus: RideStatus.DRIVER_ASSIGNED,
      actorType: RideActorType.DRIVER,
      actorId: "driver-1",
      driverId: "driver-1",
    })
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

test("requeue transition revokes previous driver ride room access", async () => {
  const currentRideRow = buildRideRow({
    id: "ride-1",
    client_id: "client-1",
    status: RideStatus.DRIVER_ASSIGNED,
    driver_id: "driver-1",
  });
  const updatedRideRow = {
    ...currentRideRow,
    status: RideStatus.PENDING_DRIVER,
    driver_id: null,
  };
  const dbClient = {
    async query(sql) {
      const statement = String(sql);

      if (statement.includes("SELECT") && statement.includes("FROM rides")) {
        return { rows: [currentRideRow] };
      }

      if (statement.includes("UPDATE rides")) {
        return { rows: [updatedRideRow] };
      }

      if (statement.includes("UPDATE drivers")) {
        return { rows: [{ user_id: "driver-1" }] };
      }

      if (statement.includes("UPDATE ride_driver_invites")) {
        return { rows: [] };
      }

      if (statement.includes("INSERT INTO ride_events")) {
        return {
          rows: [
            {
              id: "event-1",
              ride_id: "ride-1",
              status: RideStatus.PENDING_DRIVER,
              actor_type: RideActorType.SYSTEM,
              actor_id: "admin-1",
              payload: {},
              occurred_at: new Date(),
              created_at: new Date(),
            },
          ],
        };
      }

      return { rows: [] };
    },
  };

  const result = await RideService.__private.transitionRide(dbClient, {
    rideId: "ride-1",
    toStatus: RideStatus.PENDING_DRIVER,
    actorType: RideActorType.SYSTEM,
    actorId: "admin-1",
  });

  assert.deepEqual(result.revokedRideRoomUserIds, ["driver-1"]);
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

test("canViewRide only allows admin, owning client, or assigned driver", () => {
  const rideRow = {
    client_id: "client-1",
    driver_id: "driver-1",
  };

  assert.equal(canViewRide(rideRow, { id: "admin-1", role: "admin" }), true);
  assert.equal(canViewRide(rideRow, { id: "client-1", role: "client" }), true);
  assert.equal(canViewRide(rideRow, { id: "driver-1", role: "driver" }), true);

  assert.equal(canViewRide(rideRow, { id: "client-2", role: "client" }), false);
  assert.equal(canViewRide(rideRow, { id: "driver-2", role: "driver" }), false);
  assert.equal(canViewRide(rideRow, { id: "user-1", role: "user" }), false);
  assert.equal(canViewRide(rideRow, null), false);
});
