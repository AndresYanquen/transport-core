const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Uses an isolated schema; no real SMS or application accounts are touched.
test("phone OTP PostgreSQL integration", { skip: process.env.RUN_PHONE_OTP_DB_TESTS !== "1" }, async (t) => {
  const schema = `otp_test_${crypto.randomBytes(8).toString("hex")}`;
  process.env.DB_SEARCH_PATH = `${schema},public,extensions`;
  const config = require("../knexfile").test;
  const knex = require("knex")({ ...config, searchPath: [schema, "public", "extensions"],
    migrations: { ...config.migrations, schemaName: schema } });
  const { pool } = require("../src/config/database");
  t.after(async () => {
    await pool.end();
    await knex.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await knex.destroy();
  });
  await knex.raw(`CREATE SCHEMA "${schema}"`);
  await knex.migrate.latest();
  const { env } = require("../src/config");
  Object.assign(env.phoneAuth, { enabled: true, smsProvider: "mock", rolloutPercent: 100, allowedNumbers: [], hashSecret: crypto.randomBytes(32).toString("hex") });
  env.inalambria.apiKey = "sk_test_mocked_transport";
  const Sms = require("../src/modules/auth/services/otp-sms.service");
  const PhoneAuth = require("../src/modules/auth/services/phone-auth.service");
  const Users = require("../src/modules/auth/models/auth.model");
  const Refresh = require("../src/modules/auth/services/refresh-token.service");
  const codes = new Map();
  const deviceId = crypto.randomUUID();
  const simulatedSend = Sms.sendOtp;
  t.mock.method(Sms, "sendOtp", async (payload) => {
    const result = await simulatedSend(payload);
    codes.set(payload.phoneNumber, Sms.takeMockOtp(payload.phoneNumber));
    return result;
  });
  t.mock.method(require("axios"), "post", async () => assert.fail("Automated integration must not call external services"));
  const meta = { ip: "192.0.2.1", userAgent: "Flutter test" };
  async function request(phone, accountType = "client", requestMeta = meta, installation = deviceId) {
    const challenge = await PhoneAuth.requestOtp({ phoneNumber: phone, accountType, deviceId: installation, requestId: crypto.randomUUID() }, requestMeta);
    return { deviceId: installation, challengeId: challenge.challengeId, code: codes.get(phone) };
  }
  async function resetLimits() {
    await knex.raw(`TRUNCATE "${schema}".auth_phone_rate_limits, "${schema}".auth_phone_sms_requests`);
  }

  await t.test("creates verified passenger, persists hashed refresh token, and rejects replay", async () => {
    const input = await request("+573001112233");
    const session = await PhoneAuth.verifyOtp({ ...input, registration: { firstName: "OTP passenger" } }, meta);
    assert.equal(session.isNewUser, true);
    assert.equal(session.user.phoneVerified, true);
    assert.equal(session.user.email, null);
    assert.equal(session.user.role, "client");
    assert.equal(session.user.registrationComplete, true);
    assert.deepEqual(session.user.missingRegistrationFields, []);
    assert.ok(session.accessToken);
    assert.ok(session.refreshToken);
    const row = await Users.findById(session.user.id);
    assert.equal(row.password_hash, null);
    const stored = await knex("auth_refresh_tokens").where("user_id", row.id).first();
    assert.equal(stored.token_hash, Refresh.hashRefreshToken(session.refreshToken));
    await assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 401 });
    assert.equal((await knex("clients").where("user_id", row.id)).length, 1);
  });

  await t.test("existing unverified account is verified without changing profile or role", async () => {
    await resetLimits();
    const input = await request("+573001112233");
    const before = await Users.findMobileAccountByPhoneNumber("+573001112233");
    await knex("users").where("id", before.id).update({ phone_verified: false });
    const session = await PhoneAuth.verifyOtp({ ...input, registration: { firstName: "override" } }, meta);
    assert.equal(session.isNewUser, false);
    assert.equal(session.user.id, before.id);
    assert.equal(session.user.firstName, "OTP passenger");
    assert.equal(session.user.phoneVerified, true);
  });

  await t.test("only one concurrent verification can create a session", async () => {
    await resetLimits();
    const input = await request("+573001112234");
    const results = await Promise.allSettled([PhoneAuth.verifyOtp(input, meta), PhoneAuth.verifyOtp(input, meta)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const user = await Users.findMobileAccountByPhoneNumber("+573001112234");
    assert.equal((await knex("auth_refresh_tokens").where("user_id", user.id)).length, 1);
  });

  await t.test("expiry and failed delivery cannot issue sessions", async () => {
    for (const phone of ["+573001112235", "+573001112236"]) {
      await resetLimits();
      const input = await request(phone);
      const update = phone.endsWith("5") ? { expires_at: new Date(0) } : { status: "failed" };
      await knex("auth_phone_otps").where("challenge_id", input.challengeId).update(update);
      await assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 401 });
      assert.equal(await Users.findMobileAccountByPhoneNumber(phone), null);
    }
  });

  await t.test("fifth wrong attempt locks challenge and resending does not reset phone budget", async () => {
    await resetLimits();
    const input = await request("+573001112237");
    const wrong = input.code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await assert.rejects(PhoneAuth.verifyOtp({ ...input, code: wrong }, meta), { status: 401 });
    await assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 401 });
    await knex("auth_phone_sms_requests").where("challenge_id", input.challengeId).update({ created_at: new Date(Date.now() - 61000) });
    const replacement = await request("+573001112237");
    await assert.rejects(PhoneAuth.verifyOtp(replacement, meta), { status: 429 });
    await assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 401 });
  });

  await t.test("cooldown prevents simultaneous SMS requests to the same phone", async () => {
    await resetLimits();
    const results = await Promise.allSettled([request("+573001112238"), request("+573001112238")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.find((result) => result.status === "rejected").reason.status, 429);
  });

  await t.test("driver registration rollback keeps OTP usable until required profile is provided", async () => {
    await resetLimits();
    const input = await request("+573001112239", "driver");
    await assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 400 });
    assert.equal(await Users.findMobileAccountByPhoneNumber("+573001112239"), null);
    const session = await PhoneAuth.verifyOtp({ ...input, registration: { driverProfile: {
      licenseNumber: "OTP-TEST-LICENSE", vehicleMake: "Make", vehicleModel: "Model", vehiclePlate: "OTP123",
    } } }, meta);
    assert.equal(session.user.role, "driver");
    assert.equal(session.user.phoneVerified, true);
    assert.equal(session.user.driverProfile.approvalStatus, "pending");
  });

  await t.test("database disallows a passenger and driver sharing a phone", async () => {
    await assert.rejects(knex("users").insert({ phone_number: "+573001112239", role: "client" }),
      (error) => error.code === "23505");
    await assert.rejects(knex("users").insert({ phone_number: "3001112233", role: "client" }),
      (error) => error.code === "23514");
  });

  await t.test("token issuance failure rolls back account creation and OTP consumption", async () => {
    await resetLimits();
    const input = await request("+573001112240");
    const tokens = require("../src/modules/auth/models/refresh-token.model");
    const mock = t.mock.method(tokens, "create", async () => { throw new Error("simulated token failure"); });
    await assert.rejects(PhoneAuth.verifyOtp(input, meta), /simulated token failure/);
    mock.mock.restore();
    assert.equal(await Users.findMobileAccountByPhoneNumber("+573001112240"), null);
    const otp = await knex("auth_phone_otps").where("challenge_id", input.challengeId).first();
    assert.equal(otp.status, "sent");
    const session = await PhoneAuth.verifyOtp(input, meta);
    assert.equal(session.isNewUser, true);
  });

  await t.test("global and IP sending budgets prevent further SMS", async () => {
    await resetLimits();
    const calls = Sms.sendOtp.mock.callCount();
    const oldLimit = env.phoneAuth.globalDailyLimit;
    env.phoneAuth.globalDailyLimit = 1;
    try {
      await request("+573001112241");
      await assert.rejects(request("+573001112242"), { status: 429 });
      assert.equal(Sms.sendOtp.mock.callCount(), calls + 1);
      await resetLimits();
      env.phoneAuth.globalDailyLimit = oldLimit;
      const oldIp = env.phoneAuth.ipQuarterHourLimit;
      env.phoneAuth.ipQuarterHourLimit = 1;
      try {
        await request("+573001112243");
        await assert.rejects(request("+573001112244"), { status: 429 });
      } finally { env.phoneAuth.ipQuarterHourLimit = oldIp; }
    } finally { env.phoneAuth.globalDailyLimit = oldLimit; }
  });

  await t.test("idempotency prevents duplicates even with concurrent requests and elapsed cooldown", async () => {
    await resetLimits();
    const payload = { phoneNumber: "+573001112250", deviceId, requestId: crypto.randomUUID() };
    const before = Sms.sendOtp.mock.callCount();
    const results = await Promise.all([PhoneAuth.requestOtp(payload, meta), PhoneAuth.requestOtp(payload, meta)]);
    assert.equal(results[0].challengeId, results[1].challengeId);
    assert.equal(Sms.sendOtp.mock.callCount(), before + 1);
    await knex("auth_phone_sms_requests").where("request_id", payload.requestId).update({ created_at: new Date(Date.now() - 61000) });
    await PhoneAuth.requestOtp(payload, meta);
    assert.equal(Sms.sendOtp.mock.callCount(), before + 1);
    await assert.rejects(PhoneAuth.requestOtp({ ...payload, phoneNumber: "+573001112251" }, meta), { status: 400 });
  });

  await t.test("rolling hour allows only three SMS despite rotating device and IP", async () => {
    await resetLimits();
    const phone = "+573001112252";
    for (let i = 0; i < 3; i++) {
      const input = await request(phone, "client", { ip: `192.0.2.${i + 5}` }, crypto.randomUUID());
      await knex("auth_phone_sms_requests").where("challenge_id", input.challengeId)
        .update({ created_at: new Date(Date.now() - (180 - i * 60) * 1000) });
    }
    const before = Sms.sendOtp.mock.callCount();
    await assert.rejects(request(phone, "client", { ip: "198.51.100.1" }, crypto.randomUUID()), { status: 429 });
    assert.equal(Sms.sendOtp.mock.callCount(), before);
  });

  await t.test("device limit spans phones, and IPv6 interface rotation does not evade IP quota", async () => {
    await resetLimits();
    for (let i = 0; i < 3; i++) await request(`+57300111226${i}`, "client", { ip: `192.0.2.${i + 8}` });
    await assert.rejects(request("+573001112263", "client", { ip: "198.51.100.3" }), { status: 429 });
    await resetLimits();
    const old = env.phoneAuth.ipQuarterHourLimit;
    env.phoneAuth.ipQuarterHourLimit = 1;
    try {
      await request("+573001112264", "client", { ip: "2001:db8::1" }, crypto.randomUUID());
      await assert.rejects(request("+573001112265", "client", { ip: "2001:db8::2" }, crypto.randomUUID()), { status: 429 });
    } finally { env.phoneAuth.ipQuarterHourLimit = old; }
  });

  await t.test("distributed requests cannot exceed concurrent global burst budget", async () => {
    await resetLimits();
    const old = env.phoneAuth.globalMinuteLimit;
    env.phoneAuth.globalMinuteLimit = 2;
    const before = Sms.sendOtp.mock.callCount();
    try {
      const results = await Promise.allSettled(Array.from({ length: 12 }, (_v, i) =>
        request(`+573001112${String(270 + i)}`, "client", { ip: `192.0.2.${i + 20}` }, crypto.randomUUID())));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
      assert.equal(Sms.sendOtp.mock.callCount(), before + 2);
      for (const r of results.filter((r) => r.status === "rejected")) assert.equal(r.reason.status, 429);
    } finally { env.phoneAuth.globalMinuteLimit = old; }
  });

  await t.test("unknown delivery blocks fresh requests and never dispatches an idempotent retry", async () => {
    await resetLimits();
    const payload = { phoneNumber: "+573001112290", deviceId, requestId: crypto.randomUUID() };
    const timeout = t.mock.method(Sms, "sendOtp", async () => {
      throw Object.assign(new Error("simulated timeout"), { status: 503, deliveryUnknown: true });
    });
    try {
      await assert.rejects(PhoneAuth.requestOtp(payload, meta), { status: 503 });
      await assert.rejects(PhoneAuth.requestOtp(payload, meta), { status: 503 });
      await knex("auth_phone_sms_requests").where("request_id", payload.requestId).update({ created_at: new Date(Date.now() - 61000) });
      await assert.rejects(PhoneAuth.requestOtp({ ...payload, requestId: crypto.randomUUID() }, meta), { status: 429 });
      assert.equal(timeout.mock.callCount(), 1);
      assert.equal((await knex("auth_phone_sms_requests").where("request_id", payload.requestId).first()).status, "unknown");
    } finally { timeout.mock.restore(); }
  });

  await t.test("provider authorization/balance failure opens shared circuit before another dispatch", async () => {
    await resetLimits();
    const rejected = t.mock.method(Sms, "sendOtp", async () => {
      throw Object.assign(new Error("provider balance"), { status: 503, blockProvider: true });
    });
    try {
      await assert.rejects(request("+573001112291"), { status: 503 });
      await assert.rejects(request("+573001112292"), { status: 503 });
      assert.equal(rejected.mock.callCount(), 1);
    } finally {
      rejected.mock.restore();
      await knex("auth_phone_sms_control").where("id", 1).update({ blocked_until: null, blocked_reason: null });
    }
  });

  await t.test("wrong device cannot consume OTP and concurrent brute force stops at five failures", async () => {
    await resetLimits();
    const input = await request("+573001112293");
    await assert.rejects(PhoneAuth.verifyOtp({ ...input, deviceId: crypto.randomUUID() }, meta), { status: 401 });
    const wrong = input.code === "000000" ? "000001" : "000000";
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => PhoneAuth.verifyOtp({ ...input, code: wrong }, meta)));
    assert.ok(results.every((r) => r.status === "rejected"));
    const otp = await knex("auth_phone_otps").where("challenge_id", input.challengeId).first();
    assert.equal(otp.attempts, 5);
    await assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 401 });
  });

  await t.test("unverified phone contact cannot authenticate an existing Google account", async () => {
    await resetLimits();
    const google = await Users.createGoogleClientUser({ email: "otp-google@example.com", providerUserId: "otp-google-id" });
    await knex("users").where("id", google.id).update({ phone_number: "+573001112294", phone_verified: false });
    const input = await request("+573001112294");
    await assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 401 });
    assert.equal((await knex("users").where("phone_number", "+573001112294")).length, 1);
    await resetLimits();
    const linkMeta = { ...meta, linkUser: Users.toPublicUser(await Users.findById(google.id)) };
    const link = await request("+573001112294", "client", linkMeta);
    await assert.rejects(PhoneAuth.verifyOtp(link, meta), { status: 401 });
    const result = await PhoneAuth.verifyOtp(link, linkMeta);
    assert.equal(result.user.id, google.id);
    assert.equal(result.user.phoneVerified, true);
    assert.equal((await knex("users").where("phone_number", "+573001112294")).length, 1);
    await resetLimits();
    const login = await PhoneAuth.verifyOtp(await request("+573001112294"), meta);
    assert.equal(login.user.id, google.id);
    assert.equal(login.isNewUser, false);
  });

  await t.test("OTP expiration is checked after waiting for a row lock", async () => {
    await resetLimits();
    const input = await request("+573001112295");
    await knex("auth_phone_otps").where("challenge_id", input.challengeId)
      .update({ expires_at: new Date(Date.now() + 100) });
    const blocker = await pool.connect();
    let pending;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT challenge_id FROM auth_phone_otps WHERE challenge_id = $1 FOR UPDATE", [input.challengeId]);
      // Attach a rejection handler immediately while the verifier waits on the lock.
      pending = assert.rejects(PhoneAuth.verifyOtp(input, meta), { status: 401 });
      await blocker.query("SELECT pg_sleep(0.2)");
      await blocker.query("COMMIT");
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    await pending;
    assert.equal(await Users.findMobileAccountByPhoneNumber("+573001112295"), null);
  });

  await t.test("budget alerts fire at 80 percent and exhaustion without sensitive data", async () => {
    await resetLimits();
    const { logger } = require("../src/config/logger");
    const events = [];
    const warn = t.mock.method(logger, "warn", (name, metadata) => events.push({ name, metadata }));
    const old = env.phoneAuth.globalDailyLimit;
    env.phoneAuth.globalDailyLimit = 5;
    try {
      for (let i = 0; i < 5; i++) await request(`+57300111230${i}`, "client", meta, crypto.randomUUID());
      const alerts = events.filter((e) => e.name === "phone_otp_sms_budget_alert" && e.metadata.scope === "day");
      assert.deepEqual(alerts.map((e) => e.metadata.used), [4, 5]);
      assert.equal(alerts[1].metadata.exhausted, true);
      assert.ok(!JSON.stringify(events).includes("+57"));
      assert.ok(!JSON.stringify(events).includes("code"));
    } finally { env.phoneAuth.globalDailyLimit = old; warn.mock.restore(); }
  });

  const Auth = require("../src/modules/auth/services/auth.service");
  const SessionPolicy = require("../src/modules/auth/services/mobile-session.service");
  const { verifyJwt } = require("../src/modules/auth/utils/jwt");
  async function loginInstallation(phone, id = crypto.randomUUID(), extra = {}) {
    await resetLimits();
    return PhoneAuth.verifyOtp({ ...await request(phone, "client", meta, id), ...extra }, meta);
  }

  await t.test("each installation has an independent session and token family", async () => {
    const first = await loginInstallation("+573001112400", crypto.randomUUID(), {
      device: { name: "Pixel", platform: "android", appVersion: "1.0", osVersion: "15" },
    });
    const second = await loginInstallation("+573001112400", crypto.randomUUID(), {
      device: { name: "iPhone", platform: "ios", appVersion: "1.1" },
    });
    assert.notEqual(first.session.id, second.session.id);
    assert.equal(first.user.id, second.user.id);
    const rows = await knex("auth_mobile_sessions").where("user_id", first.user.id).whereNull("revoked_at");
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].family_id, rows[1].family_id);
    assert.equal(first.session.deviceName, "Pixel");
    assert.equal(first.session.platform, "android");
    assert.equal(verifyJwt(first.accessToken, { secret: env.security.jwtSecret }).sid, first.session.id);
    const token = await knex("auth_refresh_tokens").where("token_hash", Refresh.hashRefreshToken(first.refreshToken)).first();
    assert.equal(token.session_id, first.session.id);
    assert.equal(token.family_id, rows.find((r) => r.id === first.session.id).family_id);
  });

  await t.test("persistent refresh keeps its session and server TTL policy without SMS", async () => {
    const login = await loginInstallation("+573001112401", crypto.randomUUID(), { rememberMe: false });
    const before = Sms.sendOtp.mock.callCount();
    const renewed = await Auth.refreshSession({ deviceId: login.session.installationId, refreshToken: login.refreshToken, rememberMe: true,
      device: { name: "forged" } }, meta);
    assert.equal(Sms.sendOtp.mock.callCount(), before);
    assert.equal(renewed.session.id, login.session.id);
    assert.equal(renewed.session.installationId, login.session.installationId);
    assert.equal(renewed.rememberMe, false);
    await assert.rejects(Auth.refreshSession({ refreshToken: renewed.refreshToken, deviceId: crypto.randomUUID() }), { status: 401 });
    await SessionPolicy.assertActive(renewed.session.id, renewed.user.id);
    assert.ok(renewed.refreshExpiresIn <= env.security.refreshTokenTtlSeconds);
    assert.notEqual(renewed.refreshToken, login.refreshToken);
    assert.equal(verifyJwt(renewed.accessToken, { secret: env.security.jwtSecret }).sid, login.session.id);
    const tokens = await knex("auth_refresh_tokens").where("session_id", login.session.id);
    assert.equal(tokens.length, 2);
    assert.equal(new Set(tokens.map((r) => r.family_id)).size, 1);
    assert.equal(tokens.filter((r) => !r.revoked_at).length, 1);
  });

  await t.test("fresh OTP on the same installation replaces only that installation", async () => {
    const id = crypto.randomUUID();
    const old = await loginInstallation("+573001112402", id);
    const other = await loginInstallation("+573001112402");
    const current = await loginInstallation("+573001112402", id);
    assert.notEqual(current.session.id, old.session.id);
    await assert.rejects(SessionPolicy.assertActive(old.session.id, old.user.id), { status: 401 });
    await assert.rejects(Auth.refreshSession({ deviceId: old.session.installationId, refreshToken: old.refreshToken }), { status: 401 });
    await SessionPolicy.assertActive(current.session.id, current.user.id);
    await SessionPolicy.assertActive(other.session.id, other.user.id);
    assert.equal((await knex("auth_mobile_sessions").where({ user_id: current.user.id, installation_id: id }).whereNull("revoked_at")).length, 1);
  });

  await t.test("deviceId alone never restores a session and expired sessions require new OTP", async () => {
    const login = await loginInstallation("+573001112403");
    const before = Sms.sendOtp.mock.callCount();
    await assert.rejects(Auth.refreshSession({ refreshToken: "invented-token", deviceId: login.session.installationId }), { status: 401 });
    await knex("auth_mobile_sessions").where("id", login.session.id).update({ expires_at: new Date(0) });
    await assert.rejects(Auth.refreshSession({ deviceId: login.session.installationId, refreshToken: login.refreshToken }), { status: 401 });
    await assert.rejects(SessionPolicy.assertActive(login.session.id, login.user.id), { status: 401 });
    assert.equal(Sms.sendOtp.mock.callCount(), before);
    const next = await loginInstallation("+573001112403", login.session.installationId);
    assert.notEqual(next.session.id, login.session.id);
  });

  await t.test("logout revokes only one installation; logout-all revokes every installation", async () => {
    const first = await loginInstallation("+573001112404");
    const second = await loginInstallation("+573001112404");
    await Auth.logoutUser({ refreshToken: first.refreshToken });
    await assert.rejects(SessionPolicy.assertActive(first.session.id, first.user.id), { status: 401 });
    await SessionPolicy.assertActive(second.session.id, second.user.id);
    await Auth.logoutAll(second.user);
    await assert.rejects(SessionPolicy.assertActive(second.session.id, second.user.id), { status: 401 });
  });

  await t.test("reused refresh token revokes its session and leaves another installation active", async () => {
    const first = await loginInstallation("+573001112405");
    const other = await loginInstallation("+573001112405");
    const renewed = await Auth.refreshSession({ deviceId: first.session.installationId, refreshToken: first.refreshToken });
    await assert.rejects(Auth.refreshSession({ deviceId: first.session.installationId, refreshToken: first.refreshToken }), { status: 401 });
    await assert.rejects(Auth.refreshSession({ deviceId: renewed.session.installationId, refreshToken: renewed.refreshToken }), { status: 401 });
    await SessionPolicy.assertActive(other.session.id, other.user.id);
  });

  await t.test("required additional factor cannot be bypassed by OTP or a Flutter boolean", async () => {
    const login = await loginInstallation("+573001112406");
    await knex("users").where("id", login.user.id).update({ mobile_additional_factor_required: true });
    await resetLimits();
    const input = await request("+573001112406", "client", meta, crypto.randomUUID());
    await assert.rejects(PhoneAuth.verifyOtp({ ...input, additionalFactorVerified: true,
      device: { name: "Verified by client" } }, { ...meta, additionalFactorVerified: true }),
    { status: 403, code: "ADDITIONAL_FACTOR_REQUIRED" });
    const row = await knex("auth_phone_otps").where("challenge_id", input.challengeId).first();
    assert.equal(row.status, "sent");
    assert.equal((await knex("auth_mobile_sessions").where("user_id", login.user.id)).length, 1);
  });

  await t.test("session creation rolls back with token failure, preserving previous installation", async () => {
    const id = crypto.randomUUID();
    const previous = await loginInstallation("+573001112407", id);
    await resetLimits();
    const input = await request("+573001112407", "client", meta, id);
    const tokenModel = require("../src/modules/auth/models/refresh-token.model");
    const failure = t.mock.method(tokenModel, "create", async () => { throw new Error("token failure"); });
    try { await assert.rejects(PhoneAuth.verifyOtp(input, meta), /token failure/); }
    finally { failure.mock.restore(); }
    await SessionPolicy.assertActive(previous.session.id, previous.user.id);
    assert.equal((await knex("auth_mobile_sessions").where("user_id", previous.user.id)).length, 1);
  });

  await t.test("refresh racing logout cannot leave an active installation or token", async () => {
    const login = await loginInstallation("+573001112408");
    await Promise.allSettled([Auth.refreshSession({ deviceId: login.session.installationId, refreshToken: login.refreshToken }), Auth.logoutUser({ refreshToken: login.refreshToken })]);
    await assert.rejects(SessionPolicy.assertActive(login.session.id, login.user.id), { status: 401 });
    assert.equal((await knex("auth_refresh_tokens").where("session_id", login.session.id).whereNull("revoked_at")).length, 0);
  });

  await t.test("absolute session expiry cannot be extended by refresh", async () => {
    const login = await loginInstallation("+573001112409");
    const deadline = new Date(Date.now() + 60000);
    await knex("auth_mobile_sessions").where("id", login.session.id).update({ expires_at: deadline, absolute_expires_at: deadline });
    const renewed = await Auth.refreshSession({ deviceId: login.session.installationId, refreshToken: login.refreshToken });
    assert.ok(renewed.refreshExpiresIn <= 60);
    assert.ok(new Date(renewed.session.expiresAt).getTime() <= deadline.getTime());
    await knex("auth_mobile_sessions").where("id", login.session.id).update({ expires_at: new Date(0), absolute_expires_at: new Date(0) });
    await assert.rejects(Auth.refreshSession({ deviceId: renewed.session.installationId, refreshToken: renewed.refreshToken }), { status: 401 });
  });

  await t.test("legacy refresh cannot recreate full mobile access after phone enrollment", async () => {
    const login = await loginInstallation("+573001112410");
    const legacy = await Refresh.issueRefreshToken({ userId: login.user.id });
    await assert.rejects(Auth.refreshSession({ refreshToken: legacy.refreshToken }), { status: 401, code: "OTP_REQUIRED" });
    await assert.rejects(Auth.buildLoginSession(await Users.findById(login.user.id)), { code: "OTP_REQUIRED" });
    await SessionPolicy.assertActive(login.session.id, login.user.id);
  });

  await t.test("concurrent Google login creates one account and provider identity", async () => {
    const Google = require("../src/modules/auth/services/google-auth.service");
    const proof = t.mock.method(Google, "verifyGoogleIdToken", async () => ({ providerUserId: "concurrent-google-id",
      email: "concurrent-google@example.com", emailVerified: true }));
    try {
      const results = await Promise.all([Auth.loginWithGoogle({ idToken: "simulated" }), Auth.loginWithGoogle({ idToken: "simulated" })]);
      assert.equal(results[0].user.id, results[1].user.id);
      assert.equal((await knex("users").where("email", "concurrent-google@example.com")).length, 1);
      assert.equal((await knex("user_auth_providers").where("provider_user_id", "concurrent-google-id")).length, 1);
    } finally { proof.mock.restore(); }
  });

  await t.test("HTTP and Socket.IO end-to-end", async (network) => {
    const http = require("node:http");
    const { io: connect } = require("socket.io-client");
    env.redis.url = "";
    env.http.trustProxy = 0;
    env.http.requestLogsEnabled = false;
    env.realtime.enabled = true;
    env.realtime.sessionCheckIntervalMs = 100;
    const app = require("../src/app");
    const realtime = require("../src/realtime/socket.server");
    const server = http.createServer(app);
    await realtime.initializeSocketServer(server);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const clients = new Set();
    network.after(async () => {
      for (const socket of clients) socket.disconnect();
      await realtime.closeSocketServer();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    });
    async function api(path, { method = "GET", body, token } = {}) {
      const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json(), headers: response.headers };
    }
    function event(socket, name) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, done); reject(new Error(`Timed out waiting for ${name}`)); }, 3000);
        function done(...args) { clearTimeout(timer); resolve(args); }
        socket.once(name, done);
      });
    }
    function socketFor(token) {
      return new Promise((resolve, reject) => {
        const socket = connect(base, { path: env.realtime.path, auth: { token }, transports: ["websocket"],
          forceNew: true, reconnection: false, timeout: 2000 });
        clients.add(socket);
        socket.once("connect", () => resolve(socket));
        socket.once("connect_error", (error) => { socket.disconnect(); reject(error); });
      });
    }

    await network.test("public OTP endpoint validates wrong/replayed/concurrent codes and role separation", async () => {
      await resetLimits();
      const installation = crypto.randomUUID();
      const requested = await api("/api/auth/phone/request-otp", { method: "POST", body: {
        phoneNumber: "+573001112500", deviceId: installation, requestId: crypto.randomUUID(),
      } });
      assert.equal(requested.status, 200);
      const code = codes.get("+573001112500");
      const input = { deviceId: installation, challengeId: requested.body.challengeId, code };
      const wrong = await api("/api/auth/phone/verify-otp", { method: "POST", body: { ...input, code: code === "000000" ? "000001" : "000000" } });
      assert.equal(wrong.status, 401);
      const responses = await Promise.all([api("/api/auth/phone/verify-otp", { method: "POST", body: input }),
        api("/api/auth/phone/verify-otp", { method: "POST", body: input })]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
      const login = responses.find((r) => r.status === 200).body;
      assert.equal((await api("/api/auth/me", { token: login.accessToken })).status, 200);
      assert.equal((await api("/api/admin/users", { token: login.accessToken })).status, 403);
      assert.equal(responses.find((r) => r.status === 200).headers.get("cache-control"), "no-store");
    });

    await network.test("OTP account remains pending across sessions until first name is saved", async () => {
      const phone = "+573001112513";
      const login = await loginInstallation(phone);
      assert.equal(login.isNewUser, true);
      assert.ok(login.accessToken);
      assert.ok(login.refreshToken);
      assert.equal(login.user.firstName, null);
      assert.equal(login.user.registrationComplete, false);
      assert.deepEqual(login.user.missingRegistrationFields, ["firstName"]);

      const me = await api("/api/auth/me", { token: login.accessToken });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.registrationComplete, false);
      const restored = await loginInstallation(phone);
      assert.equal(restored.isNewUser, false);
      assert.equal(restored.user.registrationComplete, false);
      const refresh = await api("/api/auth/refresh", { method: "POST", body: {
        refreshToken: restored.refreshToken, deviceId: restored.session.installationId,
      } });
      assert.equal(refresh.status, 200);
      assert.equal(refresh.body.user.registrationComplete, false);
      const token = refresh.body.accessToken;

      const invalid = await api("/api/users/me", { method: "PATCH", token, body: { firstName: "   " } });
      assert.equal(invalid.status, 400);
      const forged = await api("/api/users/me", { method: "PATCH", token, body: { registrationComplete: true } });
      assert.equal(forged.status, 400);
      const updated = await api("/api/users/me", { method: "PATCH", token, body: { firstName: "  María José  " } });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.user.firstName, "María José");
      assert.equal(updated.body.user.registrationComplete, true);
      assert.deepEqual(updated.body.user.missingRegistrationFields, []);
      const current = await api("/api/users/me", { token });
      assert.equal(current.status, 200);
      assert.equal(current.body.user.registrationComplete, true);
      const completed = await loginInstallation(phone);
      assert.equal(completed.isNewUser, false);
      assert.equal(completed.user.registrationComplete, true);
      assert.equal(completed.user.id, login.user.id);
    });

    await network.test("logout revokes HTTP access, disconnects idle socket, and rejects reconnect", async () => {
      const login = await loginInstallation("+573001112501");
      const socket = await socketFor(login.accessToken);
      const delivered = event(socket, "auth-test-before");
      realtime.emitToUser(login.user.id, "auth-test-before", { ok: true });
      await delivered;
      const disconnected = event(socket, "disconnect");
      const logout = await api("/api/auth/logout", { method: "POST", body: { refreshToken: login.refreshToken } });
      assert.equal(logout.status, 200);
      await disconnected;
      assert.equal(socket.connected, false);
      assert.equal((await api("/api/auth/me", { token: login.accessToken })).status, 401);
      await assert.rejects(socketFor(login.accessToken), /session.*invalid|invalid.*session/i);
      realtime.emitToUser(login.user.id, "auth-test-after", { secret: "must not be delivered" });
      assert.equal(socket.connected, false);
    });

    await network.test("out-of-process revocation and token expiry disconnect idle sockets", async () => {
      const login = await loginInstallation("+573001112502");
      const socket = await socketFor(login.accessToken);
      const disconnected = event(socket, "disconnect");
      await knex("auth_mobile_sessions").where("id", login.session.id).update({ revoked_at: new Date() });
      await disconnected;
      assert.equal((await api("/api/auth/me", { token: login.accessToken })).status, 401);
      const second = await loginInstallation("+573001112503");
      const { signJwt } = require("../src/modules/auth/utils/jwt");
      const short = signJwt({ sub: second.user.id, sid: second.session.id, type: "access" },
        { secret: env.security.jwtSecret, expiresInSeconds: 2 });
      const expiring = await socketFor(short);
      await event(expiring, "disconnect");
      assert.equal((await api("/api/auth/me", { token: short })).status, 401);
      const refreshed = await api("/api/auth/refresh", { method: "POST", body: {
        refreshToken: second.refreshToken, deviceId: second.session.installationId,
      } });
      assert.equal(refreshed.status, 200);
    });

    await network.test("reauthentication disconnects replaced installation only after commit", async () => {
      const id = crypto.randomUUID();
      const old = await loginInstallation("+573001112504", id);
      const socket = await socketFor(old.accessToken);
      const disconnected = event(socket, "disconnect");
      const current = await loginInstallation("+573001112504", id);
      await disconnected;
      assert.equal((await api("/api/auth/me", { token: old.accessToken })).status, 401);
      assert.equal((await api("/api/auth/me", { token: current.accessToken })).status, 200);
      const currentSocket = await socketFor(current.accessToken);
      await resetLimits();
      const input = await request("+573001112504", "client", meta, id);
      const model = require("../src/modules/auth/models/refresh-token.model");
      const failure = network.mock.method(model, "create", async () => { throw new Error("simulated failure"); });
      try { assert.equal((await api("/api/auth/phone/verify-otp", { method: "POST", body: input })).status, 503); }
      finally { failure.mock.restore(); }
      assert.equal(currentSocket.connected, true);
      assert.equal((await api("/api/auth/me", { token: current.accessToken })).status, 200);
    });

    await network.test("admin/operator password login and backend roles remain enforced", async () => {
      const bcrypt = require("bcryptjs");
      for (const role of ["admin", "operator"]) {
        await Users.createUser({ email: `${role}@http-test.example`, accountType: role, passwordHash: await bcrypt.hash("AdminTest123!", 4) });
        const login = await api("/api/auth/login", { method: "POST", body: { email: `${role}@http-test.example`, password: "AdminTest123!" } });
        assert.equal(login.status, 200);
        assert.equal(login.body.user.role, role);
        assert.equal((await api("/api/admin/users", { token: login.body.accessToken })).status, 200);
        assert.equal((await api("/api/admin/users/drivers/approvals", { token: login.body.accessToken })).status, role === "admin" ? 200 : 403);
      }
      const forged = await api("/api/auth/phone/request-otp", { method: "POST", body: {
        phoneNumber: "+573001112505", deviceId: crypto.randomUUID(), requestId: crypto.randomUUID(), accountType: "admin",
      } });
      assert.equal(forged.status, 400);
      await resetLimits();
      const driver = await PhoneAuth.verifyOtp(await request("+573001112239", "driver"), meta);
      assert.equal(driver.user.role, "driver");
      assert.equal((await api("/api/admin/users", { token: driver.accessToken })).status, 403);
    });

    await network.test("Google bootstrap links OTP to the same account without duplication", async () => {
      await resetLimits();
      const Google = require("../src/modules/auth/services/google-auth.service");
      const proof = network.mock.method(Google, "verifyGoogleIdToken", async () => ({
        providerUserId: "http-google", email: "http-google@example.com", emailVerified: true,
      }));
      try {
        const google = await api("/api/auth/google", { method: "POST", body: { idToken: "simulated-google-proof" } });
        assert.equal(google.status, 200);
        assert.equal((await api("/api/rides", { token: google.body.accessToken })).status, 401);
        const id = crypto.randomUUID();
        const otp = await api("/api/auth/phone/link/request-otp", { method: "POST", token: google.body.accessToken,
          body: { phoneNumber: "+573001112506", deviceId: id, requestId: crypto.randomUUID() } });
        assert.equal(otp.status, 200);
        const linked = await api("/api/auth/phone/link/verify-otp", { method: "POST", token: google.body.accessToken,
          body: { challengeId: otp.body.challengeId, deviceId: id, code: codes.get("+573001112506") } });
        assert.equal(linked.status, 200);
        assert.equal(linked.body.user.id, google.body.user.id);
        assert.equal((await api("/api/auth/me", { token: google.body.accessToken })).status, 401);
        assert.equal((await api("/api/auth/me", { token: linked.body.accessToken })).status, 200);
        assert.equal((await knex("users").where("phone_number", "+573001112506")).length, 1);
      } finally { proof.mock.restore(); }
    });

    await network.test("lost credentials recover through OTP; verified number cannot be changed through linking", async () => {
      const original = await loginInstallation("+573001112507");
      const recovered = await loginInstallation("+573001112507", crypto.randomUUID());
      assert.equal(recovered.user.id, original.user.id);
      assert.equal(recovered.isNewUser, false);
      const before = Sms.sendOtp.mock.callCount();
      const change = await api("/api/auth/phone/link/request-otp", { method: "POST", token: recovered.accessToken,
        body: { phoneNumber: "+573001112508", deviceId: recovered.session.installationId, requestId: crypto.randomUUID() } });
      assert.equal(change.status, 400);
      assert.equal(Sms.sendOtp.mock.callCount(), before);
      assert.equal((await Users.findById(recovered.user.id)).phone_number, "+573001112507");
      const unsupported = await api("/api/auth/phone/change-number", { method: "POST", token: recovered.accessToken, body: {} });
      assert.equal(unsupported.status, 404);
    });

    await network.test("password recovery expires, is single-use under concurrency and revokes HTTP/socket sessions", async () => {
      const login = await loginInstallation("+573001112509");
      const bcrypt = require("bcryptjs");
      await knex("users").where("id", login.user.id).update({ email: "recovery@http-test.example",
        password_hash: await bcrypt.hash("OldPassword123!", 4), email_verified: true });
      const Email = require("../src/modules/email/services/email.service");
      let deliveredToken;
      const mail = network.mock.method(Email, "sendPasswordResetEmail", async ({ resetUrl }) => {
        deliveredToken = new URL(resetUrl).searchParams.get("token");
      });
      try {
        const requestRecovery = () => api("/api/auth/forgot-password", { method: "POST", body: { email: "recovery@http-test.example" } });
        assert.equal((await requestRecovery()).status, 200);
        await knex("password_reset_tokens").where("token_hash", Auth.hashToken(deliveredToken)).update({ expires_at: new Date(0) });
        assert.equal((await api("/api/auth/reset-password", { method: "POST", body: { token: deliveredToken, password: "NewPassword123!" } })).status, 400);
        assert.equal((await requestRecovery()).status, 200);
        const token = deliveredToken;
        const socket = await socketFor(login.accessToken);
        const disconnected = event(socket, "disconnect");
        const responses = await Promise.all(["NewPassword123!", "OtherPassword123!"].map(async (password) => ({ password,
          ...await api("/api/auth/reset-password", { method: "POST", body: { token, password } }) })));
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
        await disconnected;
        assert.equal((await api("/api/auth/me", { token: login.accessToken })).status, 401);
        assert.equal((await api("/api/auth/refresh", { method: "POST", body: {
          refreshToken: login.refreshToken, deviceId: login.session.installationId,
        } })).status, 401);
        assert.equal((await api("/api/auth/reset-password", { method: "POST", body: { token, password: "RepeatPassword123!" } })).status, 400);
        const user = await Users.findById(login.user.id);
        assert.equal(await bcrypt.compare(responses.find((r) => r.status === 200).password, user.password_hash), true);
      } finally { mail.mock.restore(); }
    });

    await network.test("rollout controls new SMS while an existing session still renews", async () => {
      const login = await loginInstallation("+573001112510");
      const percent = env.phoneAuth.rolloutPercent;
      const allowed = env.phoneAuth.allowedNumbers;
      try {
        env.phoneAuth.rolloutPercent = 0;
        env.phoneAuth.allowedNumbers = [];
        const before = Sms.sendOtp.mock.callCount();
        const denied = await api("/api/auth/phone/request-otp", { method: "POST", body: {
          phoneNumber: "+573001112511", deviceId: crypto.randomUUID(), requestId: crypto.randomUUID(),
        } });
        assert.equal(denied.status, 503);
        assert.equal(Sms.sendOtp.mock.callCount(), before);
        assert.equal((await api("/api/auth/refresh", { method: "POST", body: {
          refreshToken: login.refreshToken, deviceId: login.session.installationId,
        } })).status, 200);
      } finally { env.phoneAuth.rolloutPercent = percent; env.phoneAuth.allowedNumbers = allowed; }
    });

    await network.test("logout-all disconnects every installation and rejects both HTTP credentials", async () => {
      const first = await loginInstallation("+573001112512");
      const second = await loginInstallation("+573001112512");
      const a = await socketFor(first.accessToken);
      const b = await socketFor(second.accessToken);
      const closed = Promise.all([event(a, "disconnect"), event(b, "disconnect")]);
      assert.equal((await api("/api/auth/logout-all", { method: "POST", token: first.accessToken })).status, 200);
      await closed;
      for (const login of [first, second]) {
        assert.equal((await api("/api/auth/me", { token: login.accessToken })).status, 401);
        assert.equal((await api("/api/auth/refresh", { method: "POST", body: {
          refreshToken: login.refreshToken, deviceId: login.session.installationId,
        } })).status, 401);
      }
    });
  });
});
