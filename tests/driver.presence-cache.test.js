const test = require("node:test");
const assert = require("node:assert/strict");

const DriverPresenceCache = require("../src/modules/drivers/services/driver-presence-cache.service");

test("presence cache key is namespaced by driver id", () => {
  assert.equal(
    DriverPresenceCache.presenceKey("driver-123"),
    "driver:presence:driver-123"
  );
});

test("presence cache snapshot stores only recent operational fields", () => {
  const snapshot = DriverPresenceCache.buildPresenceSnapshot({
    userId: "driver-123",
    status: "online",
    availabilityIntent: "online",
    lastSeenAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:01.000Z",
    currentLocation: { lat: 5.53, lng: -73.36 },
    headingDegrees: 120,
    speedKmh: 18,
    serviceTypes: ["standard"],
    vehiclePlate: "ABC123",
    contact: { phoneNumber: "+570000000000" },
  });

  assert.deepEqual(snapshot, {
    driverId: "driver-123",
    status: "online",
    availabilityIntent: "online",
    lastSeenAt: "2026-07-28T10:00:00.000Z",
    offlineReason: undefined,
    updatedAt: "2026-07-28T10:00:01.000Z",
    currentLocation: { lat: 5.53, lng: -73.36 },
    headingDegrees: 120,
    speedKmh: 18,
    serviceTypes: ["standard"],
  });
});

test("presence cache snapshot rejects missing drivers", () => {
  assert.equal(DriverPresenceCache.buildPresenceSnapshot(null), null);
  assert.equal(DriverPresenceCache.buildPresenceSnapshot({}), null);
});
