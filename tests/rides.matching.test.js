const test = require("node:test");
const assert = require("node:assert/strict");

const RideMatchingService = require("../src/modules/rides/services/ride-matching.service");
const SettingsService = require("../src/modules/settings/services/settings.service");
const RideModel = require("../src/modules/rides/models/ride.model");

const {
  DRIVER_REQUEST_SEARCH_RADIUS_SETTING,
  getDriverRequestSearchRadiusMeters,
} = RideMatchingService.__private;

test("driver request search radius uses database setting as source of truth", async () => {
  const originalGetSetting = SettingsService.getSetting;
  const calls = [];

  SettingsService.getSetting = async (key) => {
    calls.push(key);
    return { value: "2000" };
  };

  try {
    const radiusMeters = await getDriverRequestSearchRadiusMeters();

    assert.equal(radiusMeters, 2000);
    assert.deepEqual(calls, [DRIVER_REQUEST_SEARCH_RADIUS_SETTING]);
  } finally {
    SettingsService.getSetting = originalGetSetting;
  }
});

test("driver request search radius rejects invalid database config", async () => {
  const originalGetSetting = SettingsService.getSetting;

  SettingsService.getSetting = async () => ({ value: "-1" });

  try {
    await assert.rejects(
      () => getDriverRequestSearchRadiusMeters(),
      (error) =>
        error.status === 500 &&
        /driver request search radius/.test(error.message)
    );
  } finally {
    SettingsService.getSetting = originalGetSetting;
  }
});

test("driver pending ride matching filters by driver service type", async () => {
  const originalGetSetting = SettingsService.getSetting;
  const originalListPendingRidesNearDriver = RideModel.listPendingRidesNearDriver;
  const calls = [];

  SettingsService.getSetting = async () => ({ value: "2000" });
  RideModel.listPendingRidesNearDriver = async (options) => {
    calls.push(options);
    return [];
  };

  try {
    const result = await RideMatchingService.matchPendingRidesForDriver({
      userId: "driver-1",
      status: "online",
      serviceTypes: ["standard", "xl"],
      currentLocation: {
        lat: 4.711,
        lng: -74.0721,
      },
    });

    assert.equal(result.matched, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].serviceTypes, ["standard", "xl"]);
  } finally {
    SettingsService.getSetting = originalGetSetting;
    RideModel.listPendingRidesNearDriver = originalListPendingRidesNearDriver;
  }
});
