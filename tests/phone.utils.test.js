const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizePhoneNumber } = require("../src/modules/auth/utils/phone");

test("normalizes Colombian local mobile numbers to E.164", () => {
  assert.equal(normalizePhoneNumber("300 111 2233"), "+573001112233");
});

test("normalizes Colombian international numbers to E.164", () => {
  assert.equal(normalizePhoneNumber("57 300 111 2233"), "+573001112233");
  assert.equal(normalizePhoneNumber("+57 (300) 111-2233"), "+573001112233");
});

test("rejects invalid phone numbers", () => {
  assert.throws(
    () => normalizePhoneNumber("123"),
    /valid phone number/
  );
});
