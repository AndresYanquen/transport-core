const test = require("node:test");
const assert = require("node:assert/strict");

const PreferredDriverMiddleware = require("../src/modules/preferred-drivers/middleware/preferred-driver.middleware");

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

test("preferred driver validation accepts driverId from body", async () => {
  const driverId = "123e4567-e89b-42d3-a456-426614174000";
  const result = await runMiddleware(PreferredDriverMiddleware.validateDriverId, {
    body: { driverId },
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.preferredDriverId, driverId);
});

test("preferred driver validation accepts driverId from params", async () => {
  const driverId = "123e4567-e89b-42d3-a456-426614174000";
  const result = await runMiddleware(PreferredDriverMiddleware.validateDriverId, {
    params: { driverId },
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.preferredDriverId, driverId);
});

test("preferred driver validation rejects invalid driverId", async () => {
  const result = await runMiddleware(PreferredDriverMiddleware.validateDriverId, {
    body: { driverId: "bad-id" },
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /driverId/);
});

test("preferred driver list validation accepts default limit", async () => {
  const result = await runMiddleware(PreferredDriverMiddleware.validateListQuery);

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.preferredDriverQuery, { limit: 25 });
});

test("preferred driver list validation rejects large limit", async () => {
  const result = await runMiddleware(PreferredDriverMiddleware.validateListQuery, {
    query: { limit: "101" },
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /limit/);
});
