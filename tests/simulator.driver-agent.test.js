const test = require("node:test");
const assert = require("node:assert/strict");

const DriverAgent = require("../simulator/drivers/DriverAgent");

function buildAgent({ apiData, metrics } = {}) {
  const calls = [];
  const agent = new DriverAgent({
    id: 1,
    config: {
      driverAcceptanceRate: 1,
      endpoints: {
        driverResponsePathTemplate: "/api/rides/:rideId/driver-response",
      },
      enableSockets: false,
    },
    apiClient: {
      async patch(path, options) {
        calls.push({ path, options });
        return { data: apiData || {}, durationMs: 25 };
      },
    },
    authClient: {},
    metrics:
      metrics ||
      {
        inc() {},
        observeTiming() {},
      },
    logger: { warn() {}, debug() {}, info() {} },
    abortSignal: new AbortController().signal,
  });
  agent.user = { id: "driver-1" };

  return { agent, calls };
}

test("driver agent does not simulate ride when backend ignores stale accepted invite", async () => {
  const counters = {};
  const { agent } = buildAgent({
    apiData: { ignored: true, ignoreReason: "ride_not_pending" },
    metrics: {
      inc(name) {
        counters[name] = (counters[name] || 0) + 1;
      },
      observeTiming() {},
    },
  });
  agent.pendingInvites = [{ rideId: "ride-1" }, { rideId: "ride-2" }];

  const result = await agent.respondToInvite({ rideId: "ride-1" });

  assert.equal(result, null);
  assert.equal(counters.rides_response_ignored, 1);
  assert.equal(counters.rides_accepted, undefined);
  assert.deepEqual(agent.pendingInvites, [{ rideId: "ride-2" }]);
});

test("driver agent returns ride id after accepted invite is not ignored", async () => {
  const counters = {};
  const { agent, calls } = buildAgent({
    apiData: {
      ride: {
        id: "ride-1",
        driverId: "driver-1",
      },
    },
    metrics: {
      inc(name) {
        counters[name] = (counters[name] || 0) + 1;
      },
      observeTiming() {},
    },
  });

  const result = await agent.respondToInvite({ rideId: "ride-1" });

  assert.equal(result, "ride-1");
  assert.equal(counters.rides_accepted, 1);
  assert.equal(calls[0].path, "/api/rides/ride-1/driver-response");
});

test("driver agent does not simulate ride assigned to a different driver", async () => {
  const counters = {};
  const { agent } = buildAgent({
    apiData: {
      ride: {
        id: "ride-1",
        driverId: "driver-2",
      },
    },
    metrics: {
      inc(name) {
        counters[name] = (counters[name] || 0) + 1;
      },
      observeTiming() {},
    },
  });

  const result = await agent.respondToInvite({ rideId: "ride-1" });

  assert.equal(result, null);
  assert.equal(counters.rides_response_ignored, 1);
  assert.equal(counters.rides_accepted, undefined);
});
