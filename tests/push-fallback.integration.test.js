const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

test("invitation Socket.IO/FCM fallback PostgreSQL integration", { skip: process.env.RUN_PUSH_DB_TESTS !== "1" }, async (t) => {
  const schema = `fallback_test_${crypto.randomBytes(8).toString("hex")}`;
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
  const Presence = require("../src/modules/push/services/push-presence.service");
  const Worker = require("../src/modules/push/services/push.worker");
  const { invitationEventId } = require("../src/modules/push/services/invitation-identity");
  const { env } = require("../src/config");
  env.redis.url = "";
  env.push.invitationAckWaitMs = 2000;
  env.push.visibilityTtlSeconds = 40;
  const driver = crypto.randomUUID(), other = crypto.randomUUID();
  await knex("users").insert([{ id: driver, role: "driver", phone_verified: true }, { id: other, role: "driver", phone_verified: true }]);
  for (const [id, plate] of [[driver, "FALL001"], [other, "FALL002"]]) {
    await knex("drivers").insert({ user_id: id, license_number: plate, vehicle_make: "Make", vehicle_model: "Model",
      vehicle_plate: plate, approval_status: "approved", status: "online", last_seen_at: new Date() });
    await knex("driver_service_types").insert({ driver_id: id, service_type_code: "standard", is_active: true });
  }
  async function installation(userId, token) {
    const sid = crypto.randomUUID(), iid = crypto.randomUUID();
    await knex("auth_mobile_sessions").insert({ id: sid, user_id: userId, installation_id: iid,
      family_id: crypto.randomUUID(), remember_me: false, expires_at: new Date(Date.now() + 600000),
      absolute_expires_at: new Date(Date.now() + 1200000) });
    const input = { userId, token, platform: "android", installationId: iid, sessionId: sid, securityVersion: 0, authorizedUntil: null };
    const device = await Devices.register(input);
    return { input, device, auth: { userId, role: "driver", payload: { sid, cv: 0 } } };
  }
  const first = await installation(driver, "first_fallback_token_1234567890123");
  const second = await installation(driver, "second_fallback_token_1234567890123");
  const outsider = await installation(other, "other_fallback_token_1234567890123");
  async function invitation() {
    const client = crypto.randomUUID(), ride = crypto.randomUUID();
    await knex("users").insert({ id: client, role: "client" });
    await knex("clients").insert({ user_id: client });
    await knex("rides").insert({ id: ride, client_id: client, status: "pending_driver" });
    const [i] = await knex("ride_driver_invites").insert({ ride_id: ride, driver_id: driver, status: "pending" }).returning("*");
    const invitedAt = new Date(i.invited_at).toISOString();
    return { eventId: invitationEventId({ id: i.id, invitedAt }), type: "ride.invite", inviteId: i.id,
      rideId: ride, invitedAt, title: "Solicitud", body: "Abre la app", schemaVersion: "1",
      expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
  function ack(auth, event) { return Presence.acknowledgePresentation(auth, { eventId: event.eventId, visibility: "foreground" }); }
  async function reset() {
    await knex("push_deliveries").delete();
    await knex("user_push_devices").update({ app_visibility: "unknown", visibility_valid_until: null });
  }
  async function due(event) {
    await knex("push_deliveries").where({ event_id: event.eventId }).update({ available_at: new Date(0) });
  }

  await t.test("foreground and unknown wait for ACK; a foreground report alone does not suppress", async () => {
    await reset();
    await Presence.reportVisibility(first.auth, { visibility: "foreground" });
    const event = await invitation(); await Queue.enqueue([driver], event);
    const jobs = await knex("push_deliveries").where({ event_id: event.eventId });
    assert.equal(jobs.length, 2);
    for (const job of jobs) assert.ok(new Date(job.available_at) - new Date(job.created_at) >= 1990);
    assert.deepEqual(await Queue.claim(50, 3), []);
    await due(event);
    assert.equal((await Queue.claim(50, 3)).length, 2);
  });
  await t.test("only fresh background bypasses the wait, and other push types remain immediate", async () => {
    await reset();
    await Presence.reportVisibility(first.auth, { visibility: "background" });
    await Presence.reportVisibility(second.auth, { visibility: "background" });
    await knex("user_push_devices").where({ id: second.device.id }).update({ visibility_valid_until: new Date(0) });
    const event = await invitation(); await Queue.enqueue([driver], event);
    const jobs = await Queue.claim(50, 3);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].device_id, first.device.id);
    await Queue.enqueue([other], { ...event, eventId: "important:test", type: "message.important" });
    assert.equal((await Queue.claim(50, 3))[0].device_id, outsider.device.id);
  });
  await t.test("ACK is durable, idempotent and suppresses only the acknowledging installation", async () => {
    await reset();
    const event = await invitation(); await Queue.enqueue([driver], event);
    const response = await ack(first.auth, event);
    assert.equal(response.suppressed, true);
    assert.equal((await ack(first.auth, event)).suppressed, true);
    await Queue.enqueue([driver], event);
    await due(event);
    const [job] = await Queue.claim(50, 3);
    assert.equal(job.device_id, second.device.id);
    assert.equal((await knex("push_deliveries").where({ device_id: first.device.id }).first()).status, "suppressed");
  });
  await t.test("ACK cannot suppress another user or session, expired messages, or old re-invitations", async () => {
    await reset();
    const event = await invitation(); await Queue.enqueue([driver], event);
    assert.equal((await ack(outsider.auth, event)).recorded, false);
    await assert.rejects(Presence.acknowledgePresentation(first.auth,
      { eventId: event.eventId, visibility: "foreground", installationId: second.input.installationId }), { status: 400 });
    await knex("push_deliveries").where({ event_id: event.eventId }).update({ expires_at: new Date(0) });
    assert.equal((await ack(first.auth, event)).recorded, false);
    const next = await invitation(); await Queue.enqueue([driver], next);
    await knex("ride_driver_invites").where({ id: next.inviteId }).update({ invited_at: new Date(Date.now() + 1000) });
    assert.equal((await ack(first.auth, next)).recorded, false);
  });
  await t.test("ACK after claim but before dispatch prevents Firebase invocation", async () => {
    await reset();
    const event = await invitation(); await Queue.enqueue([driver], event, first.device.id); await due(event);
    const [job] = await Queue.claim(50, 3);
    assert.equal((await ack(first.auth, event)).suppressed, true);
    assert.deepEqual(await Queue.reserveForSend([job]), []);
    await Queue.finish(job, { status: "accepted" });
    assert.equal((await knex("push_deliveries").where({ id: job.id }).first()).status, "suppressed");
  });
  await t.test("ACK during dispatch reports too late and prevents a subsequent retry", async () => {
    await reset();
    const event = await invitation(); await Queue.enqueue([driver], event, first.device.id); await due(event);
    const [job] = await Queue.claim(50, 3);
    assert.equal((await Queue.reserveForSend([job])).length, 1);
    const response = await ack(first.auth, event);
    assert.equal(response.recorded, true);
    assert.equal(response.suppressed, false);
    assert.equal(response.reason, "dispatch_already_started");
    await Queue.finish(job, { status: "pending", delaySeconds: 60 });
    assert.equal((await knex("push_deliveries").where({ id: job.id }).first()).status, "suppressed");
  });
  await t.test("concurrent ACK and dispatch reservation have exactly one winning decision", async () => {
    for (let i = 0; i < 8; i++) {
      await reset();
      const event = await invitation(); await Queue.enqueue([driver], event, first.device.id); await due(event);
      const [job] = await Queue.claim(50, 3);
      const operations = i % 2 ? [Queue.reserveForSend([job]), ack(first.auth, event)] : [ack(first.auth, event), Queue.reserveForSend([job])];
      const results = await Promise.all(operations);
      const confirmation = results.find((v) => !Array.isArray(v));
      const reserved = results.find(Array.isArray);
      assert.equal(confirmation.suppressed, reserved.length === 0);
    }
  });
  await t.test("without ACK the worker sends only the unconfirmed installation", async () => {
    await reset();
    const event = await invitation(); await Queue.enqueue([driver], event); await ack(first.auth, event); await due(event);
    const sent = [];
    await Worker.runBatch({ sendEach: async (messages) => {
      sent.push(...messages);
      return { responses: messages.map(() => ({ success: true, messageId: "mock-fcm" })) };
    } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].token, second.input.token);
    assert.equal(sent[0].data.eventId, event.eventId);
  });
  await t.test("rotation resets presence and stale queued work cannot be confirmed or dispatched", async () => {
    await reset(); await Presence.reportVisibility(first.auth, { visibility: "background" });
    const event = await invitation(); await Queue.enqueue([driver], event, first.device.id);
    const [job] = await Queue.claim(50, 3);
    first.input.token = "rotated_fallback_token_1234567890";
    await Devices.register(first.input);
    const rotated = await knex("user_push_devices").where({ id: first.device.id }).first();
    assert.equal(rotated.app_visibility, "unknown");
    assert.equal(rotated.visibility_reported_at, null);
    assert.equal(rotated.visibility_valid_until, null);
    assert.equal((await ack(first.auth, event)).recorded, false);
    assert.deepEqual(await Queue.reserveForSend([job]), []);
  });
  await t.test("revoked sessions cannot report or acknowledge presentations", async () => {
    await reset();
    const event = await invitation(); await Queue.enqueue([driver], event, second.device.id);
    await knex("auth_mobile_sessions").where({ id: second.input.sessionId }).update({ revoked_at: new Date() });
    await assert.rejects(ack(second.auth, event), { status: 401 });
    await assert.rejects(Presence.reportVisibility(second.auth, { visibility: "foreground" }), { status: 401 });
  });
  await t.test("HTTP and a real authenticated socket share presence and confirmation; emitted eventId matches FCM", async () => {
    await reset();
    const express = require("express");
    const http = require("node:http");
    const { io: connect } = require("socket.io-client");
    const SocketServer = require("../src/realtime/socket.server");
    const { authenticate } = require("../src/modules/auth/middleware/authentication.middleware");
    const { signJwt } = require("../src/modules/auth/utils/jwt");
    const app = express(); app.use(express.json());
    app.use("/api/push", authenticate, require("../src/modules/push/routes/push.routes"));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
    const server = http.createServer(app);
    await SocketServer.initializeSocketServer(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const jwt = signJwt({ sub: driver, role: "driver", type: "access", sid: first.input.sessionId, cv: 0 },
      { secret: env.security.jwtSecret, expiresInSeconds: 600 });
    const headers = { authorization: `Bearer ${jwt}`, "content-type": "application/json" };
    const socket = connect(url, { auth: { token: jwt }, transports: ["websocket"], reconnection: false, autoConnect: false });
    const oldEnabled = env.push.enabled; env.push.enabled = true;
    function socketAck(name, body) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`No ACK for ${name}`)), 3000);
        socket.emit(name, body, (reply) => { clearTimeout(timeout); resolve(reply); });
      });
    }
    try {
      const unauthorized = await fetch(`${url}/api/push/devices/presence`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"visibility":"foreground"}' });
      assert.equal(unauthorized.status, 401);
      const presence = await fetch(`${url}/api/push/devices/presence`, { method: "PATCH", headers, body: '{"visibility":"foreground"}' });
      assert.equal(presence.status, 200);
      assert.equal((await presence.json()).visibility, "foreground");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Socket connection timeout")), 3000);
        socket.once("connect", () => { clearTimeout(timeout); resolve(); });
        socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
        socket.connect();
      });
      assert.equal((await socketAck("push:presence", { visibility: "foreground" })).ok, true);
      const fixture = await invitation();
      await knex("ride_driver_invites").where({ id: fixture.inviteId }).delete();
      const shown = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("No realtime invitation")), 3000);
        socket.once("ride:invite-created", async (message) => {
          try {
            const pending = await knex("push_deliveries").where({ event_id: message.eventId, device_id: first.device.id }).first();
            assert.ok(pending, "fallback is persisted before Socket.IO can receive an ACK");
            assert.equal(message.eventId, pending.payload.eventId);
            assert.equal(message.schemaVersion, "1");
            const result = await socketAck("ride:invite-presented", { eventId: message.eventId, visibility: "foreground" });
            assert.equal(result.ok, true);
            assert.equal(result.suppressed, true);
            clearTimeout(timeout); resolve(message);
          } catch (error) { clearTimeout(timeout); reject(error); }
        });
      });
      await require("../src/modules/rides/services/ride.service").assignDriver({ rideId: fixture.rideId, driverId: driver });
      const message = await shown;
      const confirmation = await fetch(`${url}/api/push/invitations/presented`, { method: "POST", headers,
        body: JSON.stringify({ eventId: message.eventId, visibility: "foreground", userId: other }) });
      assert.equal(confirmation.status, 200);
      assert.equal((await confirmation.json()).suppressed, true);
      assert.equal((await knex("push_deliveries").where({ event_id: message.eventId, device_id: second.device.id }).first()), undefined);
    } finally {
      env.push.enabled = oldEnabled;
      socket.disconnect();
      await SocketServer.closeSocketServer();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  });
  await t.test("incremental migration rolls back without losing other push infrastructure", async () => {
    await knex.migrate.down({ name: "20261030_add_push_invitation_fallback.js" });
    assert.equal(await knex.schema.withSchema(schema).hasColumn("user_push_devices", "app_visibility"), false);
    assert.equal(await knex.schema.withSchema(schema).hasColumn("push_deliveries", "presented_at"), false);
    assert.equal(await knex.schema.withSchema(schema).hasTable("push_deliveries"), true);
    assert.equal((await knex("push_deliveries").where({ status: "suppressed" })).length, 0);
  });
});
