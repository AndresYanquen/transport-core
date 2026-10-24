const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const crypto = require("node:crypto");
const deviceId = "e7d64dc1-16f3-478f-99d8-d1e165140007";
const { env } = require("../src/config");
const Inalambria = require("../src/modules/auth/services/inalambria-sms.service");
const Sms = require("../src/modules/auth/services/otp-sms.service");
const PhoneAuth = require("../src/modules/auth/services/phone-auth.service");
const Otp = require("../src/modules/auth/models/phone-otp.model");
const Auth = require("../src/modules/auth/services/auth.service");
const Users = require("../src/modules/auth/models/auth.model");
const validate = require("../src/modules/auth/middleware/validate-phone-auth.middleware");

function configured(t) {
  const original = { ...env.phoneAuth };
  const apiKey = env.inalambria.apiKey;
  Object.assign(env.phoneAuth, { enabled: true, hashSecret: "test-only-secret".repeat(4), allowedCountries: ["CO"], smsProvider: "inalambria", rolloutPercent: 100, allowedNumbers: [] });
  env.inalambria.apiKey = "sk_test_not_a_real_key";
  t.after(() => { Object.assign(env.phoneAuth, original); env.inalambria.apiKey = apiKey; });
}

async function challenge(t) {
  configured(t);
  let saved;
  let sms;
  t.mock.method(Otp, "reserve", async (value) => { saved = value; return { dispatch: true, expiresIn: 300 }; });
  t.mock.method(Otp, "markDelivery", async () => {});
  t.mock.method(Sms, "sendOtp", async (value) => { sms = value; });
  const response = await PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "3001112233" }, { ip: "127.0.0.1" });
  return { saved, sms, response, row: { challenge_id: saved.challengeId,
    phone_number: saved.phoneNumber, code_hash: saved.codeHash, account_type: "client", purpose: "auth", target_user_id: null } };
}

test("Inalambria sends one synchronous SMS with Bearer auth", async (t) => {
  configured(t);
  t.mock.method(axios, "post", async (url, body, options) => {
    assert.equal(url, "https://api.inalambria.express/v1/messages/send");
    assert.deepEqual(body.recipients, ["+573001112233"]);
    assert.equal(body.async, false);
    assert.match(body.content, /012345/);
    assert.equal(options.headers.Authorization, "Bearer sk_test_not_a_real_key");
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.timeout, 18000);
    return { status: 200, data: { ok: true, messages: 1, consumptionId: "provider-transaction" } };
  });
  await Inalambria.sendOtp({ phoneNumber: "+573001112233", code: "012345" });
});

test("Inalambria rejects queued/rejected responses and sanitizes provider errors", async (t) => {
  configured(t);
  for (const response of [
    { status: 202, data: { jobId: "queued", status: "queued" } },
    { status: 200, data: { ok: false, messages: 0, consumptionId: "id" } },
  ]) {
    t.mock.method(axios, "post", async () => response);
    await assert.rejects(Inalambria.sendOtp({ phoneNumber: "+573001112233", code: "123456" }),
      { status: 503, message: "Unable to send verification code. Please try again later." });
  }
  const post = t.mock.method(axios, "post", async () => {
    throw Object.assign(new Error("secret-123456"), { response: { status: 402 }, config: { apiKey: "secret" } });
  });
  await assert.rejects(Inalambria.sendOtp({ phoneNumber: "+573001112233", code: "123456" }),
    (error) => error.status === 503 && !error.message.includes("secret") && !error.config && !error.cause);
  assert.equal(post.mock.callCount(), 1);
});

test("OTP stays disabled until configured", async (t) => {
  configured(t);
  env.phoneAuth.enabled = false;
  await assert.rejects(PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "3001112233" }), { status: 503 });
});

test("request stores a keyed digest, sends six digits, and returns no code or account information", async (t) => {
  const { saved, sms, response } = await challenge(t);
  assert.match(sms.code, /^\d{6}$/);
  assert.equal(sms.phoneNumber, "+573001112233");
  assert.match(saved.codeHash, /^[a-f0-9]{64}$/);
  assert.notEqual(saved.codeHash, sms.code);
  assert.deepEqual(Object.keys(response).sort(), ["challengeId", "deliveryStatus", "expiresIn", "retryAfter"]);
  assert.ok(response.expiresIn > 290 && response.expiresIn <= 300);
  assert.equal(response.retryAfter, 60);
});

test("SMS failure invalidates challenge and never reports success", async (t) => {
  configured(t);
  t.mock.method(Otp, "reserve", async () => ({ dispatch: true, expiresIn: 300 }));
  t.mock.method(Sms, "sendOtp", async () => { throw Object.assign(new Error("provider unavailable"), { status: 503 }); });
  const delivery = t.mock.method(Otp, "markDelivery", async (_id, sent) => assert.equal(sent, false));
  await assert.rejects(PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "3001112233" }), { status: 503 });
  assert.equal(delivery.mock.callCount(), 1);
});

test("request disallows administrative roles and countries outside allowlist", async (t) => {
  configured(t);
  await assert.rejects(PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "3001112233", accountType: "admin" }), { status: 400 });
  await assert.rejects(PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "+14155552671" }), { status: 400 });
});

test("verification binds code to challenge, phone and role", async (t) => {
  const { saved, sms, row } = await challenge(t);
  t.mock.method(Otp, "verify", async ({ codeMatches }) => {
    assert.equal(codeMatches(row), true);
    assert.equal(codeMatches({ ...row, phone_number: "+573009998877" }), false);
    assert.equal(codeMatches({ ...row, account_type: "driver" }), false);
    assert.equal(codeMatches({ ...row, challenge_id: "different" }), false);
    return null;
  });
  await assert.rejects(PhoneAuth.verifyOtp({ deviceId, challengeId: saved.challengeId, code: sms.code }), { status: 401 });
});

test("existing passenger login verifies phone and issues session in the OTP transaction", async (t) => {
  const { saved, sms, row } = await challenge(t);
  const user = { id: "user", role: "client", status: "active" };
  const transaction = { query: async () => ({ rows: [{ id: user.id }] }) };
  t.mock.method(Users, "findMobileAccountByPhoneNumber", async (_phone, role, tx) => {
    assert.equal(role, null); assert.equal(tx, transaction); return user;
  });
  t.mock.method(Users, "findById", async () => ({ ...user, phone_verified: true }));
  t.mock.method(Auth, "preparePhoneAccount", async () => assert.fail("must not create existing account"));
  t.mock.method(Auth, "buildLoginSession", async (verified, options) => {
    assert.equal(verified.phone_verified, true);
    assert.equal(options.transaction, transaction);
    return { accessToken: "access", refreshToken: "refresh" };
  });
  t.mock.method(Otp, "verify", async ({ complete }) => complete(row, transaction));
  const result = await PhoneAuth.verifyOtp({ deviceId, challengeId: saved.challengeId, code: sms.code,
    registration: { role: "admin" } });
  assert.equal(result.isNewUser, false);
  assert.equal(result.refreshToken, "refresh");
});

test("a verified OTP cannot switch an existing account role or unblock it", async (t) => {
  const { saved, sms, row } = await challenge(t);
  const lookup = t.mock.method(Users, "findMobileAccountByPhoneNumber", async () => ({ role: "driver", status: "active" }));
  t.mock.method(Otp, "verify", async ({ complete }) => complete(row, {}));
  await assert.rejects(PhoneAuth.verifyOtp({ deviceId, challengeId: saved.challengeId, code: sms.code }), { status: 401 });
  lookup.mock.restore();
  t.mock.method(Users, "findMobileAccountByPhoneNumber", async () => ({ role: "client", status: "blocked" }));
  await assert.rejects(PhoneAuth.verifyOtp({ deviceId, challengeId: saved.challengeId, code: sms.code }), { status: 401 });
});

test("HTTP validation rejects malformed OTP and strips privileged registration fields", () => {
  const res = { status(code) { this.code = code; return this; }, json() {} };
  const invalid = { body: { deviceId, challengeId: "not-a-uuid", code: "123456" } };
  validate.verifyOtp(invalid, res, () => assert.fail("invalid challenge"));
  assert.equal(res.code, 400);
  const req = { body: { deviceId, challengeId: "e7d64dc1-16f3-478f-99d8-d1e165140007", code: "012345",
    registration: { firstName: " Juan ", role: "admin", phoneVerified: true } } };
  let called = false;
  validate.verifyOtp(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.phoneAuthPayload.registration.firstName, "Juan");
  assert.equal(req.phoneAuthPayload.registration.role, undefined);
  assert.equal(req.phoneAuthPayload.registration.phoneVerified, undefined);
});

test("OTP generator uses crypto.randomInt and preserves six digits for zero", async (t) => {
  const random = t.mock.method(crypto, "randomInt", (minimum, maximum) => {
    assert.equal(minimum, 0); assert.equal(maximum, 1000000); return 0;
  });
  const { sms } = await challenge(t);
  assert.equal(random.mock.callCount(), 1);
  assert.equal(sms.code, "000000");
});

test("request rejects Colombian landlines before reserving or sending", async (t) => {
  configured(t);
  const reserve = t.mock.method(Otp, "reserve", async () => assert.fail("must not reserve"));
  await assert.rejects(PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "+576012345678" }), { status: 400 });
  assert.equal(reserve.mock.callCount(), 0);
});

test("replayed request does not dispatch another SMS", async (t) => {
  configured(t);
  const existing = crypto.randomUUID();
  t.mock.method(Otp, "reserve", async () => ({ dispatch: false, challengeId: existing, status: "sent", expiresIn: 200 }));
  const send = t.mock.method(Sms, "sendOtp", async () => assert.fail("must not send twice"));
  const result = await PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "3001112233" });
  assert.equal(result.challengeId, existing);
  assert.equal(result.expiresIn, 200);
  assert.equal(send.mock.callCount(), 0);
});

test("provider timeouts are unknown, non-retriable dispatches and exhaust budget", async (t) => {
  configured(t);
  t.mock.method(axios, "post", async () => { throw Object.assign(new Error("timeout with sensitive body"), { code: "ECONNABORTED" }); });
  await assert.rejects(Inalambria.sendOtp({ phoneNumber: "+573001112233", code: "123456" }),
    (error) => error.status === 503 && error.deliveryUnknown === true && error.blockProvider === false && !error.message.includes("sensitive"));
});

test("invalid credential, exhausted balance and rate-limit responses request a provider circuit break", async (t) => {
  configured(t);
  for (const status of [401, 402, 403, 429]) {
    t.mock.method(axios, "post", async () => { throw Object.assign(new Error("provider"), { response: { status } }); });
    await assert.rejects(Inalambria.sendOtp({ phoneNumber: "+573001112233", code: "123456" }),
      (error) => error.status === 503 && error.blockProvider === true);
  }
});

test("HTTP validation requires idempotency and device context", () => {
  const res = { status(code) { this.code = code; return this; }, json() {} };
  validate.requestOtp({ body: { phoneNumber: "3001112233" } }, res, () => assert.fail("missing context"));
  assert.equal(res.code, 400);
  validate.verifyOtp({ body: { code: "123456", challengeId: crypto.randomUUID() } }, res, () => assert.fail("missing device"));
  assert.equal(res.code, 400);
});

test("request logger drops query secrets and untrusted correlation identifiers", (t) => {
  const { EventEmitter } = require("node:events");
  const { logger } = require("../src/config/logger");
  const { requestLogger } = require("../src/middleware/request-logger.middleware");
  const old = env.http.requestLogsEnabled;
  env.http.requestLogsEnabled = true;
  t.after(() => { env.http.requestLogsEnabled = old; });
  let logged;
  t.mock.method(logger, "info", (_name, metadata) => { logged = metadata; });
  const res = new EventEmitter();
  res.setHeader = () => {};
  res.statusCode = 400;
  requestLogger({ headers: { "x-request-id": "sensitive-secret" }, method: "POST", path: "/api/auth/phone/verify-otp",
    originalUrl: "/api/auth/phone/verify-otp?code=123456&token=sensitive-secret", ip: "192.0.2.1" }, res, () => {});
  res.emit("finish");
  assert.equal(logged.path, "/api/auth/phone/verify-otp");
  assert.ok(!JSON.stringify(logged).includes("123456"));
  assert.ok(!JSON.stringify(logged).includes("sensitive-secret"));
});

test("OTP controller sanitizes database errors instead of logging personal data", async (t) => {
  const { logger } = require("../src/config/logger");
  const controller = require("../src/modules/auth/controllers/phone-auth.controller");
  const events = [];
  t.mock.method(logger, "error", (name, metadata) => events.push({ name, metadata }));
  t.mock.method(PhoneAuth, "verifyOtp", async () => { throw new Error("duplicate private@example.com +573001112233"); });
  let status;
  let body;
  const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; } };
  await controller.verifyOtp({ phoneAuthPayload: {}, headers: {}, ip: "192.0.2.1" }, res, () => assert.fail("must sanitize"));
  assert.equal(status, 503);
  assert.ok(!JSON.stringify({ events, body }).includes("private@example.com"));
  assert.ok(!JSON.stringify({ events, body }).includes("+573001112233"));
});

test("rollout blocks new SMS before reserving budget and supports an explicit cohort", async (t) => {
  configured(t);
  env.phoneAuth.rolloutPercent = 0;
  const reserve = t.mock.method(Otp, "reserve", async () => assert.fail("outside cohort must not reserve"));
  await assert.rejects(PhoneAuth.requestOtp({ deviceId, requestId: crypto.randomUUID(), phoneNumber: "3001112233" }), { status: 503 });
  assert.equal(reserve.mock.callCount(), 0);
  env.phoneAuth.allowedNumbers = ["+573001112233"];
  assert.doesNotThrow(() => Sms.assertRolloutAllowed("+573001112233"));
  assert.throws(() => Sms.assertRolloutAllowed("+573001112234"), { status: 503 });
  env.phoneAuth.rolloutPercent = 100;
  assert.doesNotThrow(() => Sms.assertRolloutAllowed("+573001112234"));
});

test("development mock sends no external request and exposes no code in its result", async (t) => {
  configured(t);
  const oldNodeEnv = env.nodeEnv;
  env.nodeEnv = "test";
  t.after(() => { env.nodeEnv = oldNodeEnv; });
  env.phoneAuth.smsProvider = "mock";
  env.inalambria.apiKey = "";
  const network = t.mock.method(axios, "post", async () => assert.fail("mock must not send"));
  const result = await Sms.sendOtp({ phoneNumber: "+573001112233", code: "012345" });
  assert.match(result.providerReference, /^mock:/);
  assert.ok(!JSON.stringify(result).includes("012345"));
  assert.equal(Sms.takeMockOtp("+573001112233"), "012345");
  assert.equal(Sms.takeMockOtp("+573001112233"), null);
  assert.equal(network.mock.callCount(), 0);
  env.nodeEnv = "production";
  assert.throws(() => Sms.assertConfigured(), { status: 503 });
  assert.throws(() => Sms.takeMockOtp("+573001112233"));
});

test("automated test runner cannot accidentally dispatch through the real provider", async (t) => {
  configured(t);
  const network = t.mock.method(axios, "post", async () => assert.fail("real SMS must be disabled in tests"));
  await assert.rejects(Sms.sendOtp({ phoneNumber: "+573001112233", code: "012345" }), { status: 503 });
  assert.equal(network.mock.callCount(), 0);
});
