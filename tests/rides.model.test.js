const test = require("node:test");
const assert = require("node:assert/strict");

const RideModel = require("../src/modules/rides/models/ride.model");

function countInsertColumns(sql) {
  const columnsBlock = sql.match(/INSERT INTO rides \(([\s\S]*?)\)\s*VALUES/)[1];
  return columnsBlock
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean).length;
}

function getMaxPlaceholder(sql) {
  return Math.max(
    ...Array.from(sql.matchAll(/\$(\d+)/g), (match) => Number(match[1]))
  );
}

test("insertRide keeps ride columns, value expressions, and params aligned", async () => {
  let capturedSql = null;
  let capturedParams = null;
  const dbClient = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [] };
    },
  };

  await RideModel.insertRide(dbClient, {
    trackingToken: "tracking-token",
    clientId: "client-1",
    status: "requested",
    source: "whatsapp",
    serviceType: "standard",
    pickupAddress: "Centro",
    hasDestination: false,
    pickupLocation: {
      lat: 5.535,
      lng: -73.367,
    },
  });

  assert.equal(countInsertColumns(capturedSql), 24);
  assert.equal(getMaxPlaceholder(capturedSql), 24);
  assert.equal(capturedParams.length, 24);
  assert.equal(capturedParams[4], "whatsapp");
});
