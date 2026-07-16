const test = require("node:test");
const assert = require("node:assert/strict");

const RideService = require("../src/modules/rides/services/ride.service");
const RideModel = require("../src/modules/rides/models/ride.model");
const DriverService = require("../src/modules/drivers/services/driver.service");
const SettingsService = require("../src/modules/settings/services/settings.service");

function rideRow(overrides = {}) {
  return {
    id: "67f260c2-82fa-4d90-8f28-34e63f2fb2f8",
    client_id: "57dd8e62-da68-43b9-aeef-f577e92f52c6",
    driver_id: null,
    status: "pending_driver",
    service_type: "standard",
    pickup_address: "Cra. 11 #15-62, Tunja",
    dropoff_address: null,
    request_description: null,
    has_destination: false,
    pickup_point_geojson: { type: "Point", coordinates: [-73.3642263, 5.5289] },
    dropoff_point_geojson: null,
    surge_multiplier: 1,
    currency: "USD",
    pricing_breakdown: {},
    requested_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test("listNearbyDriversForRide returns eligible nearby drivers using ride pickup and service type", async () => {
  const originalGetRideById = RideModel.getRideById;
  const originalFindAvailableDriversNear = DriverService.findAvailableDriversNear;
  const originalGetSetting = SettingsService.getSetting;
  const calls = [];

  RideModel.getRideById = async () => rideRow();
  SettingsService.getSetting = async () => ({ value: "2000" });
  DriverService.findAvailableDriversNear = async (pointWkt, options) => {
    calls.push({ pointWkt, options });
    return [{ userId: "driver-1", distanceMeters: 1200, serviceTypes: ["standard"] }];
  };

  try {
    const result = await RideService.listNearbyDriversForRide(
      "67f260c2-82fa-4d90-8f28-34e63f2fb2f8",
      { radiusMeters: "5000", limit: "12" },
      { role: "operator" }
    );

    assert.equal(result.radiusMeters, 5000);
    assert.equal(result.drivers.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pointWkt, "SRID=4326;POINT(-73.3642263 5.5289)");
    assert.equal(calls[0].options.radiusMeters, 5000);
    assert.equal(calls[0].options.limit, 12);
    assert.equal(calls[0].options.serviceType, "standard");
  } finally {
    RideModel.getRideById = originalGetRideById;
    DriverService.findAvailableDriversNear = originalFindAvailableDriversNear;
    SettingsService.getSetting = originalGetSetting;
  }
});

test("listNearbyDriversForRide can exclude previously invited drivers", async () => {
  const originalGetRideById = RideModel.getRideById;
  const originalListDriverInvites = RideModel.listDriverInvites;
  const originalFindAvailableDriversNear = DriverService.findAvailableDriversNear;
  const originalGetSetting = SettingsService.getSetting;
  let call;

  RideModel.getRideById = async () => rideRow();
  RideModel.listDriverInvites = async () => [
    { driverId: "driver-1" },
    { driverId: "driver-2" },
  ];
  SettingsService.getSetting = async () => ({ value: "2000" });
  DriverService.findAvailableDriversNear = async (_pointWkt, options) => {
    call = options;
    return [];
  };

  try {
    await RideService.listNearbyDriversForRide(
      "67f260c2-82fa-4d90-8f28-34e63f2fb2f8",
      { excludeInvited: "true" },
      { role: "admin" }
    );

    assert.deepEqual(call.excludeDriverIds, ["driver-1", "driver-2"]);
  } finally {
    RideModel.getRideById = originalGetRideById;
    RideModel.listDriverInvites = originalListDriverInvites;
    DriverService.findAvailableDriversNear = originalFindAvailableDriversNear;
    SettingsService.getSetting = originalGetSetting;
  }
});
