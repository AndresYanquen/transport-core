const test = require("node:test");
const assert = require("node:assert/strict");

const DriverHotZonesService = require("../src/modules/drivers/services/driver-hot-zones.service");
const DriverModel = require("../src/modules/drivers/models/driver.model");
const Database = require("../src/config/database");
const DriverMiddleware = require("../src/modules/drivers/middleware/driver.middleware");

test("driver heat map removes requests, client data, and driver records", async () => {
  const originalListServiceTypes = DriverModel.listServiceTypes;
  const originalQuery = Database.query;

  DriverModel.listServiceTypes = async () => [{
    code: "standard",
    name: "Estándar",
    color: "#2563EB",
    isActive: true,
    driverIsActive: true,
  }];
  let call = 0;
  Database.query = async () => {
    call += 1;
    if (call === 1) {
      return { rows: [{
        id: "zone-1",
        name: "Centro",
        type: "hot_zone",
        color: "#DC2626",
        geometry_geojson: { coordinates: [[]] },
      }] };
    }
    return { rows: [] };
  };

  try {
    const result = await DriverHotZonesService.getSnapshot("driver-1", {
      serviceType: "standard",
    });

    assert.deepEqual(Object.keys(result.totals), ["availableRequests"]);
    assert.equal(result.zones[0].metrics.availableDrivers, undefined);
    assert.equal(result.zones[0].metrics.deficit, undefined);
    assert.deepEqual(result.serviceTypes.map((service) => service.code), ["standard"]);
  } finally {
    DriverModel.listServiceTypes = originalListServiceTypes;
    Database.query = originalQuery;
  }
});

test("driver heat map adds available request counts grouped by service", async () => {
  const originalListServiceTypes = DriverModel.listServiceTypes;
  const originalQuery = Database.query;

  DriverModel.listServiceTypes = async () => [{
    code: "standard",
    name: "Estándar",
    color: "#2563EB",
    isActive: true,
    driverIsActive: true,
  }];
  let call = 0;
  Database.query = async () => {
    call += 1;
    if (call === 1) {
      return { rows: [{
        id: "zone-1",
        name: "Centro",
        type: "hot_zone",
        color: "#DC2626",
        geometry_geojson: { coordinates: [[]] },
      }] };
    }
    if (call === 2) return { rows: [{ geometry_geojson: null }] };
    return { rows: [{
      zone_id: "zone-1",
      service_type: "standard",
      service_name: "Estándar",
      service_color: "#2563EB",
      request_count: 4,
    }] };
  };

  try {
    const result = await DriverHotZonesService.getSnapshot("driver-1");
    assert.deepEqual(result.zones[0].availableRequestsByService, [{
      serviceType: "standard",
      serviceName: "Estándar",
      serviceColor: "#2563EB",
      count: 4,
    }]);
    assert.equal(result.zones[0].metrics.availableRequests, 4);
  } finally {
    DriverModel.listServiceTypes = originalListServiceTypes;
    Database.query = originalQuery;
  }
});

test("zone request details are paginated and exclude private pickup data", async () => {
  const originalListServiceTypes = DriverModel.listServiceTypes;
  const originalQuery = Database.query;

  DriverModel.listServiceTypes = async () => [{
    code: "standard",
    name: "Estándar",
    isActive: true,
    driverIsActive: true,
  }];
  Database.query = async () => ({
    rows: [{
      zone_id: "11111111-1111-4111-8111-111111111111",
      zone_name: "Centro",
      id: "ride-1",
      status: "pending_driver",
      service_type: "standard",
      service_name: "Estándar",
      service_color: "#2563EB",
      requested_at: "2026-06-19T12:00:00.000Z",
      request_age_seconds: 180,
      distance_from_driver_meters: "2534.7",
      approximate_pickup_lat: "5.535",
      approximate_pickup_lng: "-73.367",
      total_count: 1,
      pickup_address: "Must not be exposed",
    }],
  });

  try {
    const result = await DriverHotZonesService.listZoneRequests(
      "driver-1",
      "11111111-1111-4111-8111-111111111111",
      { page: 1, limit: 20, serviceType: "standard" }
    );
    assert.equal(result.pagination.total, 1);
    assert.equal(result.requests[0].pickupAddress, undefined);
    assert.equal(result.requests[0].pickupLocation, undefined);
    assert.equal(result.requests[0].clientName, undefined);
    assert.equal(result.requests[0].serviceName, "Estándar");
    assert.equal(result.requests[0].requestAgeSeconds, 180);
    assert.equal(result.requests[0].distanceFromDriverMeters, 2535);
    assert.deepEqual(result.requests[0].approximatePickup, {
      lat: 5.535,
      lng: -73.367,
      radiusMeters: 250,
    });
    assert.equal(result.requests[0].estimatedFareAmount, undefined);
  } finally {
    DriverModel.listServiceTypes = originalListServiceTypes;
    Database.query = originalQuery;
  }
});

test("zone request middleware validates pagination", () => {
  const req = {
    params: { zoneId: "11111111-1111-4111-8111-111111111111" },
    query: { page: "2", limit: "25" },
  };
  let nextCalled = false;
  DriverMiddleware.listHotZoneRequests(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.query.page, 2);
  assert.equal(req.query.limit, 25);
});

test("driver heat map rejects a service type not enabled for the driver", async () => {
  const originalListServiceTypes = DriverModel.listServiceTypes;
  DriverModel.listServiceTypes = async () => [{
    code: "standard",
    name: "Estándar",
    isActive: true,
    driverIsActive: true,
  }];

  try {
    await assert.rejects(
      () => DriverHotZonesService.getSnapshot("driver-1", { serviceType: "xl" }),
      (error) => error.status === 403
    );
  } finally {
    DriverModel.listServiceTypes = originalListServiceTypes;
  }
});
