const test = require("node:test");
const assert = require("node:assert/strict");

const RideService = require("../src/modules/rides/services/ride.service");

const { assertDriverCanClaim } = RideService.__private;

function eligibleDriver(overrides = {}) {
  return {
    status: "online",
    lastSeenAt: new Date().toISOString(),
    serviceTypes: ["standard"],
    ...overrides,
  };
}

const ride = { serviceType: "standard" };

test("driver claim eligibility accepts an online recent compatible driver", () => {
  assert.doesNotThrow(() =>
    assertDriverCanClaim({
      driver: eligibleDriver(),
      ride,
      activeRide: null,
    })
  );
});

test("driver claim eligibility rejects stale presence", () => {
  assert.throws(
    () =>
      assertDriverCanClaim({
        driver: eligibleDriver({ lastSeenAt: "2020-01-01T00:00:00.000Z" }),
        ride,
        activeRide: null,
      }),
    (error) => error.status === 409 && /stale/.test(error.message)
  );
});

test("driver claim eligibility rejects an existing active ride", () => {
  assert.throws(
    () =>
      assertDriverCanClaim({
        driver: eligibleDriver(),
        ride,
        activeRide: { id: "existing-ride" },
      }),
    (error) => error.status === 409 && /active ride/.test(error.message)
  );
});

test("driver claim eligibility rejects an unsupported service type", () => {
  assert.throws(
    () =>
      assertDriverCanClaim({
        driver: eligibleDriver({ serviceTypes: ["xl"] }),
        ride,
        activeRide: null,
      }),
    (error) => error.status === 403
  );
});
