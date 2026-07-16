const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GOOGLE_MAPS_API_KEY = "test-google-key";

const PlacesService = require("../src/modules/places/services/places.service");
const PlacesMiddleware = require("../src/modules/places/middleware/places.middleware");

function buildMockHttp(data, calls = []) {
  return {
    async get(url, options) {
      calls.push({ url, options });
      return { data };
    },
  };
}

function runMiddleware(middleware, query) {
  return new Promise((resolve) => {
    const req = { query };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve({ req, res: this, nextCalled: false });
      },
    };

    middleware(req, res, () => resolve({ req, res, nextCalled: true }));
  });
}

test("autocomplete middleware returns 400 when required params are missing", async () => {
  const result = await runMiddleware(PlacesMiddleware.autocomplete, {
    query: "Bogota",
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /sessionToken/);
});

test("autocomplete returns normalized features and does not expose API key", async () => {
  const calls = [];
  const response = await PlacesService.autocomplete(
    {
      query: "El Dorado",
      lat: 4.7016,
      lng: -74.1469,
      sessionToken: "session-1",
    },
    {
      httpClient: buildMockHttp(
        {
          status: "OK",
          predictions: [
            {
              place_id: "place-1",
              description: "Aeropuerto El Dorado, Bogota, Colombia",
              structured_formatting: { main_text: "Aeropuerto El Dorado" },
            },
          ],
        },
        calls
      ),
    }
  );

  assert.deepEqual(response, {
    features: [
      {
        id: "place-1",
        text: "Aeropuerto El Dorado",
        placeName: "Aeropuerto El Dorado, Bogota, Colombia",
        center: [0, 0],
      },
    ],
  });
  assert.equal(calls[0].options.params.key, "test-google-key");
  assert.equal(JSON.stringify(response).includes("test-google-key"), false);
});

test("google transport errors are controlled and do not expose API key", async () => {
  await assert.rejects(
    () =>
      PlacesService.autocomplete(
        {
          query: "Bogota",
          sessionToken: "session-1",
        },
        {
          httpClient: {
            async get() {
              throw new Error("upstream leaked test-google-key");
            },
          },
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.message.includes("test-google-key"), false);
      return true;
    }
  );
});

test("google denied errors include sanitized configuration detail", async () => {
  await assert.rejects(
    () =>
      PlacesService.autocomplete(
        {
          query: "Bogota",
          sessionToken: "session-1",
        },
        {
          httpClient: buildMockHttp({
            status: "REQUEST_DENIED",
            error_message: "API key test-google-key is not authorized to use this API.",
          }),
        }
      ),
    (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /not authorized/);
      assert.match(error.message, /Places API\/Geocoding API/);
      assert.equal(error.message.includes("test-google-key"), false);
      return true;
    }
  );
});

test("details returns normalized feature with coordinates", async () => {
  const response = await PlacesService.details(
    {
      placeId: "place-2",
      sessionToken: "session-2",
    },
    {
      httpClient: buildMockHttp({
        status: "OK",
        result: {
          place_id: "place-2",
          name: "Plaza de Bolivar",
          formatted_address: "Cra. 7 #11-10, Bogota, Colombia",
          geometry: { location: { lat: 4.5981, lng: -74.0758 } },
        },
      }),
    }
  );

  assert.deepEqual(response, {
    feature: {
      id: "place-2",
      text: "Plaza de Bolivar",
      placeName: "Cra. 7 #11-10, Bogota, Colombia",
      center: [-74.0758, 4.5981],
    },
  });
});

test("geocode returns normalized feature with coordinates", async () => {
  const response = await PlacesService.geocode(
    {
      query: "Cra. 7 #11-10, Bogota",
    },
    {
      httpClient: buildMockHttp({
        status: "OK",
        results: [
          {
            place_id: "geocode-1",
            formatted_address: "Cra. 7 #11-10, Bogota, Colombia",
            geometry: { location: { lat: 4.5981, lng: -74.0758 } },
          },
        ],
      }),
    }
  );

  assert.deepEqual(response, {
    feature: {
      id: "geocode-1",
      text: "Cra. 7 #11-10",
      placeName: "Cra. 7 #11-10, Bogota, Colombia",
      center: [-74.0758, 4.5981],
    },
  });
});

test("reverse geocode returns normalized feature", async () => {
  const response = await PlacesService.reverseGeocode(
    {
      lat: 4.65,
      lng: -74.06,
    },
    {
      httpClient: buildMockHttp({
        status: "OK",
        results: [
          {
            place_id: "reverse-1",
            formatted_address: "Cl. 100 #15-20, Bogota, Colombia",
            geometry: { location: { lat: 4.65, lng: -74.06 } },
          },
        ],
      }),
    }
  );

  assert.deepEqual(response, {
    feature: {
      id: "reverse-1",
      text: "Cl. 100 #15-20",
      placeName: "Cl. 100 #15-20, Bogota, Colombia",
      center: [-74.06, 4.65],
    },
  });
});
