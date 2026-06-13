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
  const originalListActiveServiceTypeCodes =
    ServiceTypeService.listActiveServiceTypeCodes;

  ServiceTypeService.listActiveServiceTypeCodes = async () => ["standard", "xl"];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypeCodes = originalListActiveServiceTypeCodes;
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
  const originalListActiveServiceTypeCodes =
    ServiceTypeService.listActiveServiceTypeCodes;

  ServiceTypeService.listActiveServiceTypeCodes = async () => ["standard"];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypeCodes = originalListActiveServiceTypeCodes;
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
  const originalListActiveServiceTypeCodes =
    ServiceTypeService.listActiveServiceTypeCodes;

  ServiceTypeService.listActiveServiceTypeCodes = async () => ["standard"];
  t.after(() => {
    ServiceTypeService.listActiveServiceTypeCodes = originalListActiveServiceTypeCodes;
  });

  const result = await runCreateRideMiddleware(buildValidRideBody());

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.body.serviceType, "standard");
});
