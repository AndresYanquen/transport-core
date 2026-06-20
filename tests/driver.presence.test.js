const test = require("node:test");
const assert = require("node:assert/strict");

const DriverMiddleware = require("../src/modules/drivers/middleware/driver.middleware");

function validate(body) {
  const req = { body };
  let response = null;
  const res = {
    status(status) {
      return {
        json(payload) {
          response = { status, payload };
          return response;
        },
      };
    },
  };
  let nextCalled = false;
  DriverMiddleware.updateLocation(req, res, () => {
    nextCalled = true;
  });
  return { req, response, nextCalled };
}

test("empty driver location payload is accepted as a heartbeat", () => {
  const result = validate({});

  assert.equal(result.nextCalled, true);
  assert.equal(result.response, null);
  assert.equal(result.req.body.hasLocation, false);
  assert.equal(result.req.body.currentLocationWkt, null);
});

test("driver presence accepts and normalizes a GPS update", () => {
  const result = validate({
    currentLocation: { lat: 4.711, lng: -74.0721 },
    heading: 120,
    speedKmh: 25,
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.body.hasLocation, true);
  assert.equal(result.req.body.currentLocationWkt, "SRID=4326;POINT(-74.0721 4.711)");
});

test("heading without a location is rejected", () => {
  const result = validate({ heading: 120 });

  assert.equal(result.nextCalled, false);
  assert.equal(result.response.status, 400);
  assert.match(result.response.payload.message, /require currentLocation/);
});
