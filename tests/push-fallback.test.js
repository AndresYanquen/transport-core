const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Presence = require("../src/modules/push/services/push-presence.service");
const Sessions = require("../src/modules/auth/services/mobile-session.service");
const Devices = require("../src/modules/push/models/push-device.model");
const Queue = require("../src/modules/push/models/push-delivery.model");
const Worker = require("../src/modules/push/services/push.worker");
const { registerPushSocketHandlers } = require("../src/modules/push/realtime/push.socket");
const { invitationEventId } = require("../src/modules/push/services/invitation-identity");
const id = crypto.randomUUID();
const auth = { userId: id, role: "driver", payload: { sid: id } };
const eventId = invitationEventId({ id, invitedAt: new Date() });
function session(t) { t.mock.method(Sessions, "assertActive", async () => ({ installation_id: id })); }

test("presentation confirmation derives its installation from the JWT and needs foreground", async (t) => {
  session(t);
  let calls = 0;
  t.mock.method(Queue, "acknowledgePresentation", async (value) => {
    calls++;
    assert.deepEqual(value, { userId: id, sessionId: id, installationId: id, eventId });
    return { recorded: true, suppressed: true };
  });
  assert.deepEqual(await Presence.acknowledgePresentation(auth, { eventId, visibility: "foreground", userId: "other", sessionId: "other" }),
    { recorded: true, suppressed: true });
  await assert.rejects(Presence.acknowledgePresentation(auth, { eventId, visibility: "background" }), { status: 400 });
  await assert.rejects(Presence.acknowledgePresentation(auth, { eventId: "ride:other", visibility: "foreground" }), { status: 400 });
  await assert.rejects(Presence.acknowledgePresentation(auth, { eventId, visibility: "foreground", installationId: crypto.randomUUID() }), { status: 400 });
  assert.equal(calls, 1);
});
test("presence is a driver-session report and never suppresses an invitation by itself", async (t) => {
  session(t);
  t.mock.method(Queue, "acknowledgePresentation", async () => assert.fail("presence must not confirm presentation"));
  t.mock.method(Devices, "reportVisibility", async (value) => ({ visibility: value.visibility }));
  assert.deepEqual(await Presence.reportVisibility(auth, { visibility: "foreground" }), { visibility: "foreground" });
  await assert.rejects(Presence.reportVisibility(auth, { visibility: "hidden" }), { status: 400 });
  await assert.rejects(Presence.reportVisibility({ ...auth, role: "client" }, { visibility: "foreground" }), { status: 403 });
  await assert.rejects(Presence.reportVisibility({ ...auth, payload: {} }, { visibility: "foreground" }), { status: 403 });
  await assert.rejects(Presence.reportVisibility(auth, null), { status: 400 });
});
test("socket confirms with authenticated identity and sanitizes unexpected errors", async (t) => {
  const handlers = {};
  const socket = { data: { auth }, on: (name, handler) => { handlers[name] = handler; } };
  t.mock.method(Presence, "acknowledgePresentation", async (receivedAuth, body) => {
    assert.equal(receivedAuth, auth);
    assert.equal(body.eventId, eventId);
    return { recorded: true, suppressed: true };
  });
  t.mock.method(Presence, "reportVisibility", async () => { throw new Error("SECRET_DATABASE_TOKEN"); });
  registerPushSocketHandlers(socket);
  let reply;
  await handlers["ride:invite-presented"]({ eventId, visibility: "foreground" }, (value) => { reply = value; });
  assert.deepEqual(reply, { ok: true, recorded: true, suppressed: true });
  await handlers["push:presence"]({ visibility: "foreground" }, (value) => { reply = value; });
  assert.equal(reply.status, 503);
  assert.equal(JSON.stringify(reply).includes("SECRET"), false);
});
test("socket limits presentation reports and does not install handlers for tracking/admin sockets", async (t) => {
  const handlers = {};
  t.mock.method(Presence, "acknowledgePresentation", async () => ({ recorded: true }));
  registerPushSocketHandlers({ data: { auth }, on: (name, handler) => { handlers[name] = handler; } });
  let reply;
  for (let i = 0; i < 121; i++) await handlers["ride:invite-presented"]({}, (value) => { reply = value; });
  assert.equal(reply.status, 429);
  for (const data of [{ auth: { scope: "ride_tracking" } }, { auth: { role: "admin", payload: {} } }]) {
    registerPushSocketHandlers({ data, on: () => assert.fail("unauthorized socket handlers") });
  }
});
test("worker never calls Firebase when the presentation ACK wins the dispatch gate", async (t) => {
  const job = { id, lease_id: id, device_id: id, expires_at: new Date(Date.now() + 60000) };
  t.mock.method(Devices, "disableRevoked", async () => {});
  t.mock.method(Queue, "cleanup", async () => {});
  t.mock.method(Queue, "claim", async () => [job]);
  t.mock.method(Queue, "eligibleDevice", async () => ({ fcm_token: "secret-token" }));
  t.mock.method(Queue, "resourceIsCurrent", async () => true);
  t.mock.method(Queue, "reserveForSend", async () => []);
  t.mock.method(Queue, "finish", async (value) => assert.equal(value.id, id));
  await Worker.runBatch({ sendEach: async () => assert.fail("confirmed presentation must suppress FCM") });
});
test("Socket.IO and FCM use a stable event identity for each invitation occurrence", () => {
  const timestamp = new Date();
  assert.equal(invitationEventId({ id, invitedAt: timestamp }), invitationEventId({ id, invitedAt: timestamp.toISOString() }));
  assert.notEqual(invitationEventId({ id, invitedAt: timestamp }), invitationEventId({ id, invitedAt: new Date(timestamp.getTime() + 1000) }));
  assert.equal(invitationEventId({ id, invitedAt: "invalid" }), null);
});
