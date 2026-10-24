const assert = require("node:assert/strict");
const test = require("node:test");
const AuthService = require("../src/modules/auth/services/auth.service");
const AuthModel = require("../src/modules/auth/models/auth.model");
const SettingsService = require("../src/modules/settings/services/settings.service");
const { pool } = require("../src/config/database");

test("public email signup cannot reserve an unverified phone number", async (t) => {
  const create = t.mock.method(AuthModel, "createUser", async () => assert.fail("must not reserve a phone"));
  await assert.rejects(AuthService.registerUser({ email: "attacker@example.com", password: "password",
    phoneNumber: "+573001112233" }), { status: 400 });
  assert.equal(create.mock.callCount(), 0);
});

test("prepares a passenger without credentials, verification or session", async (t) => {
  let saved;
  t.mock.method(AuthModel, "createUser", async (payload) => {
    saved = payload;
    return { id: "passenger", role: "client", phone_number: payload.phoneNumber,
      phone_verified: false };
  });
  const result = await AuthService.preparePhoneAccount({
    phoneNumber: "300 111 2233", email: "ignored@example.com", password: "ignored",
    role: "admin", phoneVerified: true, status: "approved",
  });
  assert.equal(saved.phoneNumber, "+573001112233");
  assert.equal(saved.accountType, "client");
  assert.equal(saved.email, null);
  assert.equal(saved.passwordHash, null);
  assert.equal(saved.emailVerificationToken, null);
  assert.equal(saved.phoneVerificationToken, null);
  assert.deepEqual(saved.clientProfile, { homeLocationWkt: null });
  assert.equal(saved.phoneVerified, undefined);
  assert.equal(saved.status, undefined);
  assert.equal(result.user.phoneVerified, false);
  assert.equal(result.accessToken, undefined);
  assert.equal(result.refreshToken, undefined);
  assert.deepEqual(result.verification, { emailSent: false, phoneToken: null });
});

test("rejects missing or invalid phones and administrative account types", async (t) => {
  const create = t.mock.method(AuthModel, "createUser", async () => assert.fail("must not create"));
  for (const payload of [{}, { phoneNumber: "123" },
    { phoneNumber: "+573001112233", accountType: "admin" },
    { phoneNumber: "+573001112233", accountType: "operator" }]) {
    await assert.rejects(AuthService.preparePhoneAccount(payload), { status: 400 });
  }
  assert.equal(create.mock.callCount(), 0);
});

test("phone drivers retain profile requirements and approval policy", async (t) => {
  await assert.rejects(AuthService.preparePhoneAccount({
    phoneNumber: "+573001112233", accountType: "driver",
  }), /Driver registrations require/);
  t.mock.method(SettingsService, "getSettingValue", async () => "pending");
  let saved;
  t.mock.method(AuthModel, "createUser", async (payload) => {
    saved = payload;
    return { id: "driver", role: "driver" };
  });
  await AuthService.preparePhoneAccount({
    phoneNumber: "+573001112233", accountType: "driver",
    driverProfile: { licenseNumber: "LICENSE", vehicleMake: "Make",
      vehicleModel: "Model", vehiclePlate: "ABC123", approvalStatus: "approved" },
  });
  assert.equal(saved.passwordHash, null);
  assert.equal(saved.driverProfile.approvalStatus, "pending");
  assert.equal(saved.clientProfile, undefined);
});

test("mobile lookup normalizes phone and restricts roles in the database", async (t) => {
  let statement;
  let parameters;
  t.mock.method(pool, "connect", async () => ({
    query: async (sql, values) => {
      statement = sql;
      parameters = values;
      return { rows: [] };
    },
    release() {},
  }));
  assert.equal(await AuthModel.findMobileAccountByPhoneNumber("3001112233"), null);
  assert.match(statement, /u.role IN \('client', 'driver'\)/);
  assert.match(statement, /u.deleted_at IS NULL/);
  assert.deepEqual(parameters, ["+573001112233", null]);
  await AuthModel.findClientByPhoneNumber("3001112233");
  assert.deepEqual(parameters, ["+573001112233", "client"]);
  await assert.rejects(AuthModel.findMobileAccountByPhoneNumber("3001112233", "admin"),
    { status: 400 });
});
