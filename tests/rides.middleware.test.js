const test = require("node:test");
const assert = require("node:assert/strict");

const RideMiddleware = require("../src/modules/rides/middleware/rides.middleware");
const ServiceTypeService = require("../src/modules/service-types/services/service-type.service");

function buildValidRideBody(overrides = {}) {
  return {
    clientId: "client-1",
    pickupAddress: "Pickup",
    pickupLocation: {
      lat: 4.711,
      lng: -74.0721,
    },
    ...overrides,
  };
}

function runCreateRideMiddleware(body) {
  return new Promise((resolve) => {
    const req = { body };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ req, res: this, nextCalled: false });
      },
    };

    RideMiddleware.createRide(req, res, (error) => {
      resolve({ req, res, nextCalled: !error, error });
    });
  });
}

test("create ride validation accepts active service type from database", async (t) => {
  const originalListActiveServiceTypes =
    ServiceTypeService.listActiveServiceTypes;

  ServiceTypeService.listActiveServiceTypes = async () => [
    { code: "standard", category: "ride" },
    { code: "xl", category: "ride" },
  ];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypes = originalListActiveServiceTypes;
  });

  const result = await runCreateRideMiddleware(
    buildValidRideBody({
      serviceType: "xl",
    })
  );

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.body.serviceType, "xl");
});

test("create ride validation rejects inactive or missing service type", async (t) => {
  const originalListActiveServiceTypes =
    ServiceTypeService.listActiveServiceTypes;

  ServiceTypeService.listActiveServiceTypes = async () => [
    { code: "standard", category: "ride" },
  ];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypes = originalListActiveServiceTypes;
  });

  const result = await runCreateRideMiddleware(
    buildValidRideBody({
      serviceType: "xl",
    })
  );

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /active service types/);
});

test("create ride validation defaults service type to standard", async (t) => {
  const originalListActiveServiceTypes =
    ServiceTypeService.listActiveServiceTypes;

  ServiceTypeService.listActiveServiceTypes = async () => [
    { code: "standard", category: "ride" },
  ];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypes = originalListActiveServiceTypes;
  });

  const result = await runCreateRideMiddleware(buildValidRideBody());

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.body.serviceType, "standard");
});

test("create ride validation requires destination and description for delivery service types", async (t) => {
  const originalListActiveServiceTypes =
    ServiceTypeService.listActiveServiceTypes;

  ServiceTypeService.listActiveServiceTypes = async () => [
    { code: "package_delivery", category: "delivery" },
  ];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypes = originalListActiveServiceTypes;
  });

  const missingDestination = await runCreateRideMiddleware(
    buildValidRideBody({
      serviceType: "package_delivery",
      requestDescription: "Small box",
    })
  );

  assert.equal(missingDestination.nextCalled, false);
  assert.equal(missingDestination.res.statusCode, 400);
  assert.match(missingDestination.res.body.message, /Delivery service types/);

  const missingDescription = await runCreateRideMiddleware(
    buildValidRideBody({
      serviceType: "package_delivery",
      pickupAddress: "Sender",
      dropoffAddress: "Recipient",
      pickupLocation: { lat: 4.711, lng: -74.0721 },
      dropoffLocation: { lat: 4.72, lng: -74.08 },
    })
  );

  assert.equal(missingDescription.nextCalled, false);
  assert.equal(missingDescription.res.statusCode, 400);
  assert.match(missingDescription.res.body.message, /requestDescription/);
});

test("create ride validation accepts delivery with destination and description", async (t) => {
  const originalListActiveServiceTypes =
    ServiceTypeService.listActiveServiceTypes;

  ServiceTypeService.listActiveServiceTypes = async () => [
    { code: "package_delivery", category: "delivery" },
  ];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypes = originalListActiveServiceTypes;
  });

  const result = await runCreateRideMiddleware(
    buildValidRideBody({
      serviceType: "package_delivery",
      pickupAddress: "Sender",
      dropoffAddress: "Recipient",
      pickupLocation: { lat: 4.711, lng: -74.0721 },
      dropoffLocation: { lat: 4.72, lng: -74.08 },
      requestDescription: " Small box with documents ",
    })
  );

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.body.hasDestination, true);
  assert.equal(result.req.body.requestDescription, "Small box with documents");
});
