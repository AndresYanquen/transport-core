const test = require("node:test");
const assert = require("node:assert/strict");

const ServiceTypeMiddleware = require("../src/modules/service-types/middleware/service-type.middleware");

function runMiddleware(middleware, { body = {}, params = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const req = { body, params, query };
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

    middleware(req, res, () => {
      resolve({ req, res, nextCalled: true });
    });
  });
}

test("service type create validation accepts valid payload", async () => {
  const result = await runMiddleware(ServiceTypeMiddleware.validateCreateServiceType, {
    body: {
      code: "xl",
      name: "XL",
      description: "Larger vehicle",
      icon: "bus",
      basePrice: "5000",
      isActive: true,
      sortOrder: "40",
    },
  });

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.serviceTypePayload, {
    code: "xl",
    name: "XL",
    description: "Larger vehicle",
    icon: "bus",
    basePrice: 5000,
    isActive: true,
    sortOrder: 40,
  });
});

test("service type create validation rejects invalid code", async () => {
  const result = await runMiddleware(ServiceTypeMiddleware.validateCreateServiceType, {
    body: {
      code: "XL Ride",
      name: "XL",
    },
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /code/);
});

test("service type create validation rejects negative base price", async () => {
  const result = await runMiddleware(ServiceTypeMiddleware.validateCreateServiceType, {
    body: {
      code: "xl",
      name: "XL",
      basePrice: -1,
    },
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /basePrice/);
});

test("service type update validation accepts partial payload", async () => {
  const result = await runMiddleware(ServiceTypeMiddleware.validateUpdateServiceType, {
    body: {
      isActive: false,
      sortOrder: 50,
    },
  });

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.serviceTypePayload, {
    isActive: false,
    sortOrder: 50,
    hasDescription: false,
    hasIcon: false,
  });
});

test("service type update validation requires supported fields", async () => {
  const result = await runMiddleware(ServiceTypeMiddleware.validateUpdateServiceType, {
    body: {
      code: "premium",
    },
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /At least one/);
});

test("service type code param validation rejects malformed code", async () => {
  const result = await runMiddleware(ServiceTypeMiddleware.validateCodeParam, {
    params: {
      code: "Premium",
    },
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /code/);
});
