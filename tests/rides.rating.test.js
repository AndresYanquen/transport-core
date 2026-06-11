const test = require("node:test");
const assert = require("node:assert/strict");

const { RideStatus } = require("../src/modules/rides/constants/ride-status");
const RatingService = require("../src/modules/rides/services/ride-rating.service");

const { normalizeTags, determineRatee, updateAggregateForRatee } =
  RatingService.__private;

function buildRideRow(overrides = {}) {
  return {
    id: "ride-1",
    status: RideStatus.COMPLETED,
    client_id: "client-1",
    driver_id: "driver-1",
    ...overrides,
  };
}

test("normalizeTags returns unique trimmed tags", () => {
  const tags = normalizeTags([" clean ", "clean", "", "  ", "fast"]);
  assert.deepEqual(tags, ["clean", "fast"]);
});

test("determineRatee enforces completed rides", () => {
  assert.throws(
    () =>
      determineRatee({
        rideRow: buildRideRow({ status: RideStatus.IN_PROGRESS }),
        raterRole: "client",
        raterUserId: "client-1",
      }),
    /completed/i
  );
});

test("client rates driver only for own ride", () => {
  assert.throws(
    () =>
      determineRatee({
        rideRow: buildRideRow({ client_id: "client-2" }),
        raterRole: "client",
        raterUserId: "client-1",
      }),
    /own rides/i
  );
});

test("driver rates client only for assigned ride", () => {
  assert.throws(
    () =>
      determineRatee({
        rideRow: buildRideRow({ driver_id: "driver-2" }),
        raterRole: "driver",
        raterUserId: "driver-1",
      }),
    /assigned/i
  );
});

test("updateAggregateForRatee recalculates rating without changing total trips", async () => {
  const calls = [];
  const dbClient = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });

      if (String(sql).includes("SELECT user_id")) {
        return { rows: [{ user_id: "driver-1" }] };
      }

      if (String(sql).includes("AVG(stars)")) {
        return { rows: [{ avg_stars: 4.5 }] };
      }

      return { rows: [] };
    },
  };

  await updateAggregateForRatee(dbClient, {
    rateeUserId: "driver-1",
    rateeRole: "driver",
  });

  const updateCall = calls.find((call) => call.sql.includes("UPDATE drivers"));

  assert.ok(updateCall);
  assert.equal(updateCall.sql.includes("total_trips"), false);
  assert.deepEqual(updateCall.params, ["driver-1", 4.5]);
});
