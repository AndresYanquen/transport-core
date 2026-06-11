const test = require("node:test");
const assert = require("node:assert/strict");

const RideMatchingService = require("../src/modules/rides/services/ride-matching.service");
const SettingsService = require("../src/modules/settings/services/settings.service");

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
