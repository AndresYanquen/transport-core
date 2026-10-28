const test = require("node:test");
const assert = require("node:assert/strict");
const { env } = require("../src/config");
const Devices = require("../src/modules/push/models/push-device.model");
const DeviceService = require("../src/modules/push/services/push-device.service");
const Sessions = require("../src/modules/auth/services/mobile-session.service");
const Queue = require("../src/modules/push/models/push-delivery.model");
const Push = require("../src/modules/push/services/push.service");
const Events = require("../src/modules/push/services/push-events.service");
const Worker = require("../src/modules/push/services/push.worker");
const uuid = "d66a5414-15cb-46b1-a188-b4bd1fd4e1bb";
const token = "fcm_token_for_a_mock_device_123456789";
const auth = { userId: uuid, role: "driver", payload: { sid: uuid, cv: 0 } };
function notification(overrides = {}) {
  return { eventId: "important:1", type: "message.important", title: "Aviso", body: "Abre la app.",
    expiresAt: new Date(Date.now() + 180000), ...overrides };
}
function enabled(t) {
  const previous = env.push.enabled;
  env.push.enabled = true;
  t.after(() => { env.push.enabled = previous; });
}

test("device registration derives identity and installation from the active session", async (t) => {
  t.mock.method(Sessions, "assertActive", async () => ({ installation_id: uuid }));
  let input;
  t.mock.method(Devices, "register", async (value) => { input = value; return { id: uuid }; });
  await DeviceService.register(auth, { token, platform: "android", userId: "attacker", sessionId: "attacker" });
  assert.equal(input.userId, uuid);
  assert.equal(input.sessionId, uuid);
  assert.equal(input.installationId, uuid);
  assert.equal(input.authorizedUntil, null);
});
test("device validation rejects missing token, unknown platform and mismatched installation", async (t) => {
  t.mock.method(Sessions, "assertActive", async () => ({ installation_id: uuid }));
  await assert.rejects(DeviceService.register(auth, { platform: "android" }), { status: 400 });
  await assert.rejects(DeviceService.register(auth, { token, platform: "desktop" }), { status: 400 });
  await assert.rejects(DeviceService.register(auth, { token, platform: "ios", installationId: "74ebc726-6261-427c-8de6-0aa5451a05fb" }), { status: 400 });
  await assert.rejects(DeviceService.register({ ...auth, payload: {} }, { token, platform: "android" }), { code: "OTP_REQUIRED" });
});
test("web registrations require an installation and expire with administrative authorization", async (t) => {
  const web = { userId: uuid, role: "operator", payload: { exp: 2000000000, cv: 2 } };
  t.mock.method(Devices, "register", async (value) => value);
  await assert.rejects(DeviceService.register(web, { token, platform: "web" }), { status: 400 });
  const value = await DeviceService.register(web, { token, platform: "web", installationId: uuid });
  assert.equal(value.authorizedUntil.getTime(), web.payload.exp * 1000);
  assert.equal(value.securityVersion, 2);
});
test("unregister is scoped to the authenticated session", async (t) => {
  t.mock.method(Sessions, "assertActive", async () => ({ installation_id: uuid }));
  t.mock.method(Devices, "unregister", async (value) => {
    assert.deepEqual(value, { userId: uuid, sessionId: uuid, installationId: uuid, token });
  });
  await DeviceService.unregister(auth, { token, userId: "somebody-else" });
});
test("disabled push does not contact persistence", async (t) => {
  const old = env.push.enabled; env.push.enabled = false;
  t.after(() => { env.push.enabled = old; });
  t.mock.method(Queue, "enqueue", async () => assert.fail("disabled push must not use queue"));
  assert.deepEqual(await Push.sendToUser(uuid, notification()), { queued: 0, disabled: true });
});
test("enqueue deduplicates recipients and strips private fields", async (t) => {
  enabled(t);
  t.mock.method(Queue, "enqueue", async (ids, payload) => {
    assert.deepEqual(ids, [uuid]);
    assert.equal(payload.jwt, undefined);
    assert.equal(payload.phoneNumber, undefined);
    assert.equal(payload.schemaVersion, "1");
    return 2;
  });
  assert.deepEqual(await Push.sendToUsers([uuid, uuid], notification({ jwt: "secret", phoneNumber: "private" })), { queued: 2 });
});
test("queue failures cannot reject business operations; expired messages are not enqueued", async (t) => {
  enabled(t);
  let calls = 0;
  t.mock.method(Queue, "enqueue", async () => { calls++; throw new Error("token and DB details must not leak"); });
  assert.equal((await Push.sendToUser(uuid, notification())).failed, true);
  assert.deepEqual(await Push.sendToUser(uuid, notification({ expiresAt: new Date(0) })), { queued: 0 });
  assert.equal(calls, 1);
  await Events.safely(async () => { throw new Error("provider failure"); });
});
test("invitations have stable event IDs including re-invitation timestamp", async (t) => {
  enabled(t);
  const seen = [];
  t.mock.method(Push, "sendToUser", async (_, value) => seen.push(value));
  const invitedAt = new Date().toISOString();
  const input = { ride: { id: uuid }, invites: [{ id: uuid, driverId: uuid, invitedAt }] };
  await Events.invitations(input); await Events.invitations(input);
  assert.equal(seen[0].eventId, seen[1].eventId);
  await Events.invitations({ ...input, invites: [{ ...input.invites[0], invitedAt: new Date(Date.now() + 1000).toISOString() }] });
  assert.notEqual(seen[1].eventId, seen[2].eventId);
});
test("ride status sends minimal notices to affected users and excludes the actor", async (t) => {
  enabled(t);
  t.mock.method(Push, "sendToUsers", async (ids, value) => {
    assert.deepEqual(ids, ["driver"]);
    assert.equal(value.type, "ride.status");
    assert.equal(value.status, "canceled_by_client");
    assert.equal(value.pickupAddress, undefined);
  });
  await Events.rideStatus({ ride: { id: uuid, clientId: "client", driverId: "driver", status: "canceled_by_client", pickupAddress: "private" },
    event: { id: uuid, actorId: "client", occurredAt: new Date() } });
});
test("error policy disables only explicit invalid tokens and honors retry-after", () => {
  assert.equal(Worker.errorPolicy({ code: "messaging/registration-token-not-registered" }, 1).invalid, true);
  for (const code of ["messaging/invalid-argument", "messaging/quota-exceeded", "messaging/server-unavailable"]) {
    assert.equal(Worker.errorPolicy({ code }, 1).invalid, false);
  }
  const policy = Worker.errorPolicy({ code: "messaging/server-unavailable", httpResponse: { headers: { "retry-after": "240" } } }, 1);
  assert.equal(policy.retryable, true);
  assert.equal(policy.delaySeconds, 240);
  assert.equal(Worker.errorPolicy({ code: "token-secret-value" }, 1).code, "provider-error");
});
test("message payload contains strings and platform expiry", () => {
  const job = { event_id: "event", payload: Push.normalize(notification()), expires_at: new Date(Date.now() + 60000) };
  const message = Worker.buildMessage(job, token);
  assert.equal(message.token, token);
  assert.equal(message.notification.title, "Aviso");
  assert.ok(Object.values(message.data).every((value) => typeof value === "string"));
  assert.equal(message.apns.headers["apns-push-type"], "alert");
  assert.ok(message.android.ttl > 0 && message.android.ttl <= 60000);
});
test("worker handles partial success, invalid tokens, transient failures and stale devices separately", async (t) => {
  const jobs = [0, 1, 2, 3].map((id) => ({ id: String(id), device_id: String(id), user_id: uuid,
    registration_version: uuid, event_id: "event", attempts: 1, payload: Push.normalize(notification()), expires_at: new Date(Date.now() + 180000) }));
  t.mock.method(Devices, "disableRevoked", async () => {});
  t.mock.method(Queue, "cleanup", async () => {});
  t.mock.method(Queue, "claim", async () => jobs);
  t.mock.method(Queue, "eligibleDevice", async (job) => job.id === "3" ? null : { fcm_token: `${token}_${job.id}` });
  t.mock.method(Queue, "resourceIsCurrent", async () => true);
  t.mock.method(Queue, "reserveForSend", async (jobs) => jobs.map((job) => ({ id: job.id, fcm_token: token })));
  const finished = new Map();
  t.mock.method(Queue, "finish", async (job, result) => finished.set(job.id, result));
  let disabled;
  t.mock.method(Devices, "disableInvalidToken", async (id, version) => { disabled = [id, version]; });
  await Worker.runBatch({ sendEach: async (messages) => {
    assert.equal(messages.length, 3);
    return { responses: [{ success: true, messageId: "fcm:1" },
      { success: false, error: { code: "messaging/registration-token-not-registered" } },
      { success: false, error: { code: "messaging/server-unavailable" } }] };
  } });
  assert.equal(finished.get("0").status, "accepted");
  assert.equal(finished.get("1").status, "failed");
  assert.equal(finished.get("2").status, "pending");
  assert.equal(finished.get("3").status, "discarded");
  assert.deepEqual(disabled, ["1", uuid]);
});
test("global provider errors remain bounded and do not deactivate devices", async (t) => {
  const job = { id: uuid, device_id: uuid, user_id: uuid, registration_version: uuid, event_id: "event",
    attempts: env.push.maxAttempts, payload: Push.normalize(notification()), expires_at: new Date(Date.now() + 180000) };
  t.mock.method(Devices, "disableRevoked", async () => {});
  t.mock.method(Queue, "cleanup", async () => {});
  t.mock.method(Queue, "claim", async () => [job]);
  t.mock.method(Queue, "eligibleDevice", async () => ({ fcm_token: token }));
  t.mock.method(Queue, "resourceIsCurrent", async () => true);
  t.mock.method(Queue, "reserveForSend", async (jobs) => jobs.map((job) => ({ id: job.id, fcm_token: token })));
  t.mock.method(Devices, "disableInvalidToken", async () => assert.fail("network errors are not invalid tokens"));
  t.mock.method(Queue, "finish", async (_, result) => assert.equal(result.status, "failed"));
  await Worker.runBatch({ sendEach: async () => { throw { code: "app/network-error" }; } });
});
