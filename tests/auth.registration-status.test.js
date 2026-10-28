const test = require("node:test");
const assert = require("node:assert/strict");
const Users = require("../src/modules/auth/models/auth.model");

test("mobile registration stays pending until a nonempty first name exists", () => {
  for (const role of ["client", "driver"]) {
    for (const first_name of [undefined, null, "", "   ", "\t\n"]) {
      const user = Users.toPublicUser({ role, first_name });
      assert.equal(user.registrationComplete, false);
      assert.deepEqual(user.missingRegistrationFields, ["firstName"]);
    }
  }
});

test("first name completes mobile registration without last name or email", () => {
  for (const role of ["client", "driver"]) {
    const user = Users.toPublicUser({ role, first_name: "María José", last_name: null, email: null });
    assert.equal(user.registrationComplete, true);
    assert.deepEqual(user.missingRegistrationFields, []);
  }
});

test("stored profile flags cannot bypass the derived registration state", () => {
  const user = Users.toPublicUser({ role: "client", first_name: null, profile: { registrationComplete: true } });
  assert.equal(user.registrationComplete, false);
});

test("registration completion does not add requirements for administrative roles", () => {
  for (const role of ["admin", "operator"]) {
    const user = Users.toPublicUser({ role, first_name: null });
    assert.equal(user.registrationComplete, true);
    assert.deepEqual(user.missingRegistrationFields, []);
  }
  assert.equal(Users.toPublicUser(null), null);
});
