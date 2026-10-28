const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

test("push PostgreSQL integration", { skip: process.env.RUN_PUSH_DB_TESTS !== "1" }, async (t) => {
  const schema = `push_test_${crypto.randomBytes(8).toString("hex")}`;
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
  const Devices = require("../src/modules/push/models/push-device.model");
  const Queue = require("../src/modules/push/models/push-delivery.model");
  const Service = require("../src/modules/push/services/push-device.service");
  const Worker = require("../src/modules/push/services/push.worker");
  const { env } = require("../src/config");
  const a = crypto.randomUUID(), b = crypto.randomUUID(), mobile = crypto.randomUUID();
  await knex("users").insert([{ id: a, role: "admin" }, { id: b, role: "operator" }, { id: mobile, role: "driver" }]);
  const installA = crypto.randomUUID(), installB = crypto.randomUUID();
  function input(userId = a, installationId = installA, token = "mock_push_token_123456789012345") {
    return { userId, token, installationId, platform: "web", sessionId: null, securityVersion: 0,
      authorizedUntil: new Date(Date.now() + 600000) };
  }
  function payload(eventId = crypto.randomUUID()) {
    return { eventId, type: "message.important", title: "Aviso", body: "Abre la app", schemaVersion: "1",
      expiresAt: new Date(Date.now() + 300000).toISOString() };
  }
  let device;
  await t.test("register is idempotent, redacts tokens and supports multiple devices", async () => {
    device = await Devices.register(input());
    const again = await Devices.register(input());
    assert.equal(device.id, again.id);
    assert.equal(device.fcm_token, undefined);
    assert.equal(JSON.stringify(await Devices.list(a)).includes("mock_push_token"), false);
    await Devices.register(input(a, installB, "mock_second_token_1234567890123"));
    assert.equal((await Devices.list(a)).length, 2);
  });
  await t.test("rotation fences queued deliveries and stale invalidation", async () => {
    await Queue.enqueue([a], payload());
    const jobs = await Queue.claim(50, 3);
    const previous = jobs.find((job) => job.device_id === device.id);
    await Devices.register(input(a, installA, "mock_rotated_token_1234567890123"));
    assert.equal(await Queue.eligibleDevice(previous), undefined);
    await Devices.disableInvalidToken(device.id, previous.registration_version);
    assert.equal((await knex("user_push_devices").where({ id: device.id }).first()).enabled, true);
    for (const job of jobs) await Queue.finish(job, { status: "discarded" });
  });
  await t.test("cross-account transfer cannot route old work to the new user", async () => {
    await Queue.enqueue([a], payload());
    const job = (await Queue.claim(50, 3)).find((j) => j.device_id === device.id);
    const next = await Devices.register(input(b, crypto.randomUUID(), "mock_rotated_token_1234567890123"));
    assert.equal(await Queue.eligibleDevice(job), undefined);
    assert.notEqual(next.id, device.id);
    assert.equal(await knex("user_push_devices").where({ fcm_token: "mock_rotated_token_1234567890123", enabled: true }).count().first().then((v) => Number(v.count)), 1);
    await Devices.unregister({ userId: a, sessionId: null, token: "mock_rotated_token_1234567890123" });
    assert.equal((await knex("user_push_devices").where({ id: next.id }).first()).enabled, true);
  });
  await t.test("concurrent registrations preserve token uniqueness", async () => {
    const token = "concurrent_token_123456789012345";
    await Promise.all([Devices.register(input(a, crypto.randomUUID(), token)), Devices.register(input(b, crypto.randomUUID(), token))]);
    const rows = await knex("user_push_devices").where({ fcm_token: token });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].enabled, true);
  });
  await t.test("event deduplication and concurrent claim exclude duplicate work", async () => {
    await knex("push_deliveries").delete();
    const event = payload();
    const count = await Queue.enqueue([a], event);
    assert.ok(count > 0);
    assert.equal(await Queue.enqueue([a, a], event), 0);
    const claims = await Promise.all([Queue.claim(1, 3), Queue.claim(1, 3)]);
    const ids = claims.flat().map((job) => job.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, Math.min(2, count));
  });
  await t.test("lease recovery rejects updates from an obsolete worker", async () => {
    const row = await knex("push_deliveries").where({ status: "processing" }).first();
    await knex("push_deliveries").where({ id: row.id }).update({ lease_until: new Date(0) });
    const [recovered] = await Queue.claim(1, 3);
    assert.equal(recovered.id, row.id);
    assert.notEqual(recovered.lease_id, row.lease_id);
    await Queue.finish(row, { status: "accepted" });
    assert.equal((await knex("push_deliveries").where({ id: row.id }).first()).status, "processing");
    await Queue.finish(recovered, { status: "accepted", messageId: "mock" });
  });
  await t.test("expired authorizations are disabled and cannot receive queued work", async () => {
    await knex("user_push_devices").where({ user_id: a }).update({ authorized_until: new Date(0) });
    assert.equal(await Queue.enqueue([a], payload()), 0);
    await Devices.disableRevoked();
    assert.equal((await knex("user_push_devices").where({ user_id: a, enabled: true })).length, 0);
  });
  const session = crypto.randomUUID(), installation = crypto.randomUUID();
  await knex("auth_mobile_sessions").insert({ id: session, user_id: mobile, installation_id: installation,
    family_id: crypto.randomUUID(), remember_me: false, expires_at: new Date(Date.now() + 300000),
    absolute_expires_at: new Date(Date.now() + 600000) });
  await t.test("mobile session binding, revocation and delete ownership", async () => {
    const mobileInput = { ...input(mobile, installation, "mobile_token_1234567890123456789"), sessionId: session, authorizedUntil: null, platform: "android" };
    await Devices.register(mobileInput);
    await assert.rejects(Devices.register({ ...mobileInput, installationId: crypto.randomUUID() }), { status: 401 });
    const event = payload(); await Queue.enqueue([mobile], event);
    const job = (await Queue.claim(50, 3)).find((j) => j.user_id === mobile);
    assert.ok(await Queue.eligibleDevice(job));
    await Devices.unregister({ userId: b, sessionId: null, installationId: installation });
    assert.ok(await Queue.eligibleDevice(job));
    await knex("auth_mobile_sessions").where({ id: session }).update({ revoked_at: new Date() });
    assert.equal(await Queue.eligibleDevice(job), undefined);
    await Devices.disableRevoked();
    assert.equal((await knex("user_push_devices").where({ user_id: mobile }).first()).fcm_token, null);
  });
  await t.test("worker sends to the surviving devices using only mocked Firebase", async () => {
    await knex("push_deliveries").delete();
    await Devices.register(input(a, installA, "worker_token_1234567890123456789"));
    await Queue.enqueue([a], payload());
    let sent = 0;
    await Worker.runBatch({ sendEach: async (messages) => {
      sent += messages.length;
      return { responses: messages.map(() => ({ success: true, messageId: "mock-provider" })) };
    } });
    assert.equal(sent, 1);
    assert.equal((await knex("push_deliveries").first()).status, "accepted");
  });
  await t.test("invitation and ride guards reject stale state, wrong recipients and unavailable drivers", async () => {
    const rider = crypto.randomUUID(), rideId = crypto.randomUUID();
    await knex("users").insert({ id: rider, role: "client" });
    await knex("clients").insert({ user_id: rider });
    await knex("drivers").insert({ user_id: mobile, license_number: "PUSH-TEST", vehicle_make: "Make",
      vehicle_model: "Model", vehicle_plate: "PUSH001", approval_status: "approved", status: "online", last_seen_at: new Date() });
    await knex("driver_service_types").insert({ driver_id: mobile, service_type_code: "standard", is_active: true });
    await knex("rides").insert({ id: rideId, client_id: rider, status: "pending_driver" });
    const [invite] = await knex("ride_driver_invites").insert({ ride_id: rideId, driver_id: mobile, status: "pending" }).returning("*");
    const job = { user_id: mobile, payload: { type: "ride.invite", rideId, inviteId: invite.id,
      invitedAt: new Date(invite.invited_at).toISOString() } };
    assert.equal(await Queue.resourceIsCurrent(job), true);
    await knex("drivers").where({ user_id: mobile }).update({ status: "offline" });
    assert.equal(await Queue.resourceIsCurrent(job), false);
    await knex("drivers").where({ user_id: mobile }).update({ status: "online" });
    await knex("ride_driver_invites").where({ id: invite.id }).update({ invited_at: new Date(Date.now() + 1000) });
    assert.equal(await Queue.resourceIsCurrent(job), false);
    await knex("ride_driver_invites").where({ id: invite.id }).update({ invited_at: invite.invited_at });
    await knex("rides").where({ id: rideId }).update({ status: "driver_assigned", driver_id: mobile });
    assert.equal(await Queue.resourceIsCurrent(job), false);
    const [event] = await knex("ride_events").insert({ ride_id: rideId, status: "driver_assigned", actor_type: "driver", actor_id: mobile }).returning("*");
    const statusJob = { user_id: rider, payload: { type: "ride.status", rideId, status: "driver_assigned", sourceEventId: event.id } };
    assert.equal(await Queue.resourceIsCurrent(statusJob), true);
    assert.equal(await Queue.resourceIsCurrent({ ...statusJob, user_id: b }), false);
    await knex("rides").where({ id: rideId }).update({ status: "driver_en_route" });
    assert.equal(await Queue.resourceIsCurrent(statusJob), false);
    const [panic] = await knex("driver_notifications").insert({ driver_id: mobile, type: "panic", priority: "emergency", title: "Alert", message: "Test" }).returning("*");
    const panicJob = { user_id: a, payload: { type: "driver.panic", notificationId: panic.id } };
    assert.equal(await Queue.resourceIsCurrent(panicJob), true);
    assert.equal(await Queue.resourceIsCurrent({ ...panicJob, user_id: mobile }), false);
    await knex("driver_notifications").where({ id: panic.id }).update({ status: "acknowledged" });
    assert.equal(await Queue.resourceIsCurrent(panicJob), false);
  });
  await t.test("ride commit succeeds before push and survives queue failure", async (st) => {
    const RideService = require("../src/modules/rides/services/ride.service");
    const ride = await knex("rides").where({ driver_id: mobile }).first();
    const oldEnabled = env.push.enabled; env.push.enabled = true;
    st.after(() => { env.push.enabled = oldEnabled; });
    let calls = 0;
    st.mock.method(Queue, "enqueue", async () => {
      // A separate DB connection sees the committed state before enqueue begins.
      assert.equal((await knex("rides").where({ id: ride.id }).first()).status, "driver_arrived");
      calls++;
      throw new Error("Simulated queue outage");
    });
    const result = await RideService.driverProgress({ rideId: ride.id, driverId: mobile, status: "driver_arrived" });
    assert.equal(result.ride.status, "driver_arrived");
    assert.equal(calls, 1);
    const again = await RideService.driverProgress({ rideId: ride.id, driverId: mobile, status: "driver_arrived" });
    assert.equal(again.idempotent, true);
    assert.equal(calls, 1);
  });
  await t.test("HTTP requires JWT and registration uses only its validated identity", async () => {
    const express = require("express");
    const { authenticate } = require("../src/modules/auth/middleware/authentication.middleware");
    const Controller = require("../src/modules/push/controllers/push-device.controller");
    const { signJwt } = require("../src/modules/auth/utils/jwt");
    const app = express(); app.use(express.json());
    app.post("/devices", authenticate, Controller.register);
    app.delete("/devices", authenticate, Controller.unregister);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/devices`;
      assert.equal((await fetch(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status, 401);
      const jwt = signJwt({ sub: a, role: "admin", type: "access", cv: 0 }, { secret: env.security.jwtSecret, expiresInSeconds: 600 });
      const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ token: "http_token_123456789012345678901", platform: "web", installationId: installA, userId: b }) });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.device.id, device.id);
      assert.equal(JSON.stringify(body).includes("http_token"), false);
      const stored = await knex("user_push_devices").where({ id: body.device.id }).first();
      assert.equal(stored.user_id, a);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
