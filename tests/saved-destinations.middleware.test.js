const test = require("node:test");
const assert = require("node:assert/strict");

const SavedDestinationMiddleware = require("../src/modules/saved-destinations/middleware/saved-destination.middleware");

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

test("saved destination create validation accepts required fields", async () => {
  const result = await runMiddleware(
    SavedDestinationMiddleware.validateCreateDestination,
    {
      body: {
        label: "Work",
        placeName: "Office",
        formattedAddress: "123 Main St",
        placeId: "google-place-id",
        location: {
          lat: 4.711,
          lng: -74.0721,
        },
      },
    }
  );

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.savedDestinationPayload, {
    label: "Work",
    placeName: "Office",
    formattedAddress: "123 Main St",
    placeId: "google-place-id",
    lat: 4.711,
    lng: -74.0721,
  });
});

test("saved destination create validation rejects invalid location", async () => {
  const result = await runMiddleware(
    SavedDestinationMiddleware.validateCreateDestination,
    {
      body: {
        label: "Work",
        placeName: "Office",
        location: {
          lat: 120,
          lng: -74.0721,
        },
      },
    }
  );

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /location/);
});

test("saved destination update validation accepts partial changes", async () => {
  const result = await runMiddleware(
    SavedDestinationMiddleware.validateUpdateDestination,
    {
      body: {
        label: "Airport",
      },
    }
  );

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.savedDestinationPayload, {
    label: "Airport",
    hasFormattedAddress: false,
    hasPlaceId: false,
    hasLocation: false,
  });
});

test("saved destination update validation requires at least one supported field", async () => {
  const result = await runMiddleware(
    SavedDestinationMiddleware.validateUpdateDestination,
    {
      body: {
        usageCount: 10,
      },
    }
  );

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /At least one/);
});

test("saved destination id validation requires uuid", async () => {
  const result = await runMiddleware(
    SavedDestinationMiddleware.validateDestinationId,
    {
      params: {
        id: "not-a-uuid",
      },
    }
  );

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /UUID/);
});

test("saved destination list validation caps limit", async () => {
  const result = await runMiddleware(
    SavedDestinationMiddleware.validateListQuery,
    {
      query: {
        limit: "101",
      },
    }
  );

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /limit/);
});
