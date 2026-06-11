const test = require("node:test");
const assert = require("node:assert/strict");

const PreferencesService = require("../src/modules/preferences/services/preferences.service");
const PreferencesMiddleware = require("../src/modules/preferences/middleware/preferences.middleware");

const { withDefaults } = PreferencesService.__private;

function runMiddleware(body) {
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

    PreferencesMiddleware.validatePreferencesPatch(req, res, () => {
      resolve({ req, res, nextCalled: true });
    });
  });
}

test("preferences defaults include theme and language", () => {
  assert.deepEqual(withDefaults({ wheelchairAccessible: false }), {
    theme: "system",
    language: "en",
    wheelchairAccessible: false,
  });
});

test("preferences defaults work when user profile has no preferences", () => {
  assert.deepEqual(withDefaults({}), {
    theme: "system",
    language: "en",
  });
});

test("preferences validation accepts theme and language patch", async () => {
  const result = await runMiddleware({
    theme: "dark",
    language: "es-CO",
  });

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.preferencesPatch, {
    theme: "dark",
    language: "es-CO",
  });
});

test("preferences validation rejects unsupported theme", async () => {
  const result = await runMiddleware({
    theme: "midnight",
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /theme/);
});

test("preferences validation requires at least one supported key", async () => {
  const result = await runMiddleware({
    notifications: true,
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /theme or language/);
});
