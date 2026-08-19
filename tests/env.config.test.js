const assert = require("node:assert/strict");
const test = require("node:test");

const { formatPostgresSearchPath } = require("../src/config/env");

test("postgres search path is formatted without quoted identifiers for connection options", () => {
  assert.equal(
    formatPostgresSearchPath(["public", "extensions"]),
    "public,extensions"
  );
});

test("postgres search path drops invalid schema identifiers", () => {
  assert.equal(
    formatPostgresSearchPath(["public", '"extensions"', "bad-name"]),
    "public"
  );
});
