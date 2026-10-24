const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const Auth = require("../src/modules/auth/services/auth.service");
const Policy = require("../src/modules/auth/services/mobile-session.service");
const { installationMetadata } = require("../src/modules/auth/utils/phone-auth-context");
const { verifyJwt } = require("../src/modules/auth/utils/jwt");
const { env } = require("../src/config");

test("mobile access JWT binds a server-issued session ID", () => {
  const id = crypto.randomUUID();
  const signed = Auth.signAccessToken({ id: "user", role: "client" }, { sessionId: id });
  assert.equal(verifyJwt(signed.accessToken, { secret: env.security.jwtSecret }).sid, id);
});

test("installation metadata is bounded and cannot provide authentication proof", () => {
  const id = crypto.randomUUID();
  const installation = installationMetadata(id.toUpperCase(), { name: " My phone ", platform: "android",
    appVersion: "1.2.3", osVersion: "15", additionalFactorVerified: true, sessionId: "forged" });
  assert.deepEqual(installation, { deviceId: id, name: "My phone", platform: "android", appVersion: "1.2.3", osVersion: "15" });
  assert.throws(() => installationMetadata(id, { name: "x".repeat(101) }), { status: 400 });
  assert.throws(() => installationMetadata(id, { platform: "admin" }), { status: 400 });
  assert.throws(() => installationMetadata("device", {}), { status: 400 });
});

test("additional-factor policy fails closed and ignores client-supplied claims", async () => {
  const user = { id: "user", role: "client", status: "active", mobile_additional_factor_required: true };
  assert.throws(() => Policy.assertAdditionalFactorPolicy(user), { code: "ADDITIONAL_FACTOR_REQUIRED", status: 403 });
  await assert.rejects(Auth.buildLoginSession(user, { metadata: { additionalFactorVerified: true },
    mobileInstallation: { deviceId: crypto.randomUUID() } }), { code: "ADDITIONAL_FACTOR_REQUIRED" });
  assert.doesNotThrow(() => Policy.assertAdditionalFactorPolicy({ ...user, mobile_additional_factor_required: false }));
});

test("legacy mobile tokens only bootstrap enrollment, never bypass installation OTP", () => {
  const user = { role: "client", phone_verified: false };
  assert.doesNotThrow(() => Policy.assertAccessContext(user, {}, "/api/auth/phone/link/verify-otp"));
  assert.throws(() => Policy.assertAccessContext(user, {}, "/api/rides"), { code: "OTP_REQUIRED" });
  assert.throws(() => Policy.assertAccessContext({ ...user, phone_verified: true }, {}, "/api/auth/me"), { code: "OTP_REQUIRED" });
  assert.doesNotThrow(() => Policy.assertAccessContext({ role: "admin" }, {}, "/api/admin"));
});

test("HTTP middleware rejects a revoked sid even with a valid JWT and claimed device", async (t) => {
  const Users = require("../src/modules/auth/models/auth.model");
  const Sessions = require("../src/modules/auth/models/mobile-session.model");
  const { authenticate } = require("../src/modules/auth/middleware/authentication.middleware");
  const user = { id: crypto.randomUUID(), role: "client", status: "active" };
  t.mock.method(Users, "findById", async () => user);
  t.mock.method(Sessions, "findActive", async () => null);
  const signed = Auth.signAccessToken(user, { sessionId: crypto.randomUUID() });
  let status;
  const res = { status(code) { status = code; return this; }, json() {} };
  await authenticate({ headers: { authorization: `Bearer ${signed.accessToken}` }, body: { deviceId: crypto.randomUUID() } },
    res, () => assert.fail("revoked session must not authenticate"));
  assert.equal(status, 401);
});
