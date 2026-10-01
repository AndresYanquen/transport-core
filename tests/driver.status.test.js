const test = require("node:test");
const assert = require("node:assert/strict");

const DriverModel = require("../src/modules/drivers/models/driver.model");

function buildDriverRow(overrides = {}) {
  return {
    user_id: "driver-1",
    license_number: "DRV-1",
    vehicle_make: "Chevrolet",
    vehicle_model: "Sail",
    vehicle_year: 2020,
    vehicle_color: "Yellow",
    vehicle_plate: "MUS707",
    vehicle_type: "sedan",
    service_types: ["standard"],
    rating: "0",
    total_trips: 0,
    status: "online",
    availability_intent: "online",
    last_seen_at: new Date("2026-09-30T20:49:27.574Z"),
    offline_reason: null,
    documents: {},
    onboarded_at: new Date("2026-01-01T00:00:00.000Z"),
    approval_status: "approved",
    approval_notes: null,
    reviewed_by_admin_id: null,
    reviewed_at: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-09-30T20:49:27.574Z"),
    current_location_geojson: {
      type: "Point",
      coordinates: [-73.36325, 5.53237],
    },
    heading_degrees: null,
    speed_kmh: null,
    email: "driver@example.com",
    first_name: "Andres",
    last_name: "Yanquen",
    phone_number: "+570000000000",
    profile_image_url: null,
    ...overrides,
  };
}

test("busy driver without active rides can go online", async () => {
  const calls = [];
  const dbClient = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return {
        rows: [
          buildDriverRow({
            status: "online",
            availability_intent: "online",
          }),
        ],
      };
    },
  };

  const driver = await DriverModel.updateStatus("driver-1", "online", dbClient);

  assert.equal(driver.status, "online");
  assert.equal(driver.availabilityIntent, "online");
  assert.match(calls[0].sql, /EXISTS\s*\(\s*SELECT 1\s+FROM rides r/);
  assert.match(calls[0].sql, /driver_assigned/);
  assert.deepEqual(calls[0].params, ["online", "driver-1"]);
});

test("busy driver with an active ride remains busy when requesting online", async () => {
  const dbClient = {
    async query() {
      return {
        rows: [
          buildDriverRow({
            status: "busy",
            availability_intent: "online",
          }),
        ],
      };
    },
  };

  const driver = await DriverModel.updateStatus("driver-1", "online", dbClient);

  assert.equal(driver.status, "busy");
  assert.equal(driver.availabilityIntent, "online");
});
