const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const AuthModel = require("../src/modules/auth/models/auth.model");
const RideService = require("../src/modules/rides/services/ride.service");
const WhatsappSessionModel = require("../src/modules/whatsapp/models/whatsapp-session.model");
const WhatsappWebhookEventModel = require("../src/modules/whatsapp/models/whatsapp-webhook-event.model");
const KapsoWhatsappService = require("../src/modules/whatsapp/services/kapso-whatsapp.service");

const {
  extractMessage,
  isTaxiIntent,
  isConfirmation,
  verifyKapsoWebhook,
  summarizeKapsoPayload,
  KAPSO_MESSAGE_RECEIVED_EVENT,
} = KapsoWhatsappService.__private;

const SECRET = "test-kapso-secret";

function signPayload(payload, secret = SECRET) {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
}

function buildHeaders(payload, overrides = {}) {
  return {
    "x-webhook-event": KAPSO_MESSAGE_RECEIVED_EVENT,
    "x-webhook-signature": signPayload(payload),
    "x-idempotency-key": crypto.randomUUID(),
    "x-webhook-payload-version": "v2",
    ...overrides,
  };
}

function installConversationStubs(t, { initialSession, duplicate = false } = {}) {
  const originalSecret = process.env.KAPSO_WEBHOOK_SECRET;
  const originalFindClientByPhoneNumber = AuthModel.findClientByPhoneNumber;
  const originalCreatePhoneOnlyClient = AuthModel.createPhoneOnlyClient;
  const originalFindByPhone = WhatsappSessionModel.findByPhone;
  const originalUpsertSession = WhatsappSessionModel.upsertSession;
  const originalResetSession = WhatsappSessionModel.resetSession;
  const originalReserveIdempotencyKey = WhatsappWebhookEventModel.reserveIdempotencyKey;
  const originalMarkProcessed = WhatsappWebhookEventModel.markProcessed;
  const originalReleaseReservation = WhatsappWebhookEventModel.releaseReservation;
  const originalCreateRide = RideService.createRide;

  const calls = {
    createdRides: [],
    markedProcessed: [],
    released: [],
    reserved: [],
    sessions: [],
  };
  let currentSession = initialSession || null;

  process.env.KAPSO_WEBHOOK_SECRET = SECRET;
  AuthModel.findClientByPhoneNumber = async () => ({
    id: "client-1",
    phoneNumber: "+573001234567",
  });
  AuthModel.createPhoneOnlyClient = async () => {
    throw new Error("unexpected client creation");
  };
  WhatsappSessionModel.findByPhone = async () => currentSession;
  WhatsappSessionModel.upsertSession = async (session) => {
    currentSession = {
      id: "session-1",
      phone: session.phone,
      userId: session.userId,
      state: session.state,
      context: session.context || {},
      expiresAt: session.expiresAt,
    };
    calls.sessions.push(currentSession);
    return currentSession;
  };
  WhatsappSessionModel.resetSession = async (session) => {
    currentSession = {
      id: "session-1",
      phone: session.phone,
      userId: session.userId,
      state: "START",
      context: {},
      expiresAt: session.expiresAt,
    };
    calls.sessions.push(currentSession);
    return currentSession;
  };
  WhatsappWebhookEventModel.reserveIdempotencyKey = async (event) => {
    calls.reserved.push(event);
    return {
      reserved: !duplicate,
      event: duplicate ? null : { id: "event-1", ...event },
    };
  };
  WhatsappWebhookEventModel.markProcessed = async (idempotencyKey) => {
    calls.markedProcessed.push(idempotencyKey);
    return { idempotencyKey, processedAt: new Date() };
  };
  WhatsappWebhookEventModel.releaseReservation = async (idempotencyKey) => {
    calls.released.push(idempotencyKey);
  };
  RideService.createRide = async (payload) => {
    calls.createdRides.push(payload);
    return {
      ride: {
        id: `ride-${calls.createdRides.length}`,
        source: payload.source,
        hasDestination: payload.hasDestination,
      },
    };
  };

  t.after(() => {
    process.env.KAPSO_WEBHOOK_SECRET = originalSecret;
    AuthModel.findClientByPhoneNumber = originalFindClientByPhoneNumber;
    AuthModel.createPhoneOnlyClient = originalCreatePhoneOnlyClient;
    WhatsappSessionModel.findByPhone = originalFindByPhone;
    WhatsappSessionModel.upsertSession = originalUpsertSession;
    WhatsappSessionModel.resetSession = originalResetSession;
    WhatsappWebhookEventModel.reserveIdempotencyKey = originalReserveIdempotencyKey;
    WhatsappWebhookEventModel.markProcessed = originalMarkProcessed;
    WhatsappWebhookEventModel.releaseReservation = originalReleaseReservation;
    RideService.createRide = originalCreateRide;
  });

  return calls;
}

test("extractMessage accepts common Kapso-style text payloads", () => {
  const message = extractMessage({
    from: "3001234567",
    message: {
      body: "Taxi",
    },
  });

  assert.equal(message.phone, "3001234567");
  assert.equal(message.text, "Taxi");
});

test("extractMessage accepts Kapso v2 conversation phone and text body", () => {
  const message = extractMessage({
    message: {
      from: "+15551234567",
      text: {
        body: "This is a test message from Kapso webhook testing",
      },
      type: "text",
    },
    conversation: {
      phone_number: "+15551234567",
      contact_name: "kapso_test_user",
    },
  });

  assert.equal(message.phone, "+15551234567");
  assert.equal(message.text, "This is a test message from Kapso webhook testing");
});

test("summarizeKapsoPayload logs Kapso v2 shape without full raw payload", () => {
  const summary = summarizeKapsoPayload({
    test: true,
    message: {
      id: "wamid.TEST",
      from: "+15551234567",
      text: {
        body: "This is a test message from Kapso webhook testing",
      },
      type: "text",
      kapso: {
        origin: "cloud_api",
        direction: "inbound",
      },
      timestamp: "1787702808",
    },
    conversation: {
      id: "test-conv",
      status: "active",
      username: "kapso_test_user",
      contact_name: "kapso_test_user",
      phone_number: "+15551234567",
      phone_number_id: "597907523413541",
      kapso: {
        messages_count: 0,
      },
      last_active_at: "2026-08-25T20:06:48-04:00",
    },
    phone_number_id: "597907523413541",
    is_new_conversation: false,
  });

  assert.deepEqual(summary.topLevelKeys, [
    "conversation",
    "is_new_conversation",
    "message",
    "phone_number_id",
    "test",
  ]);
  assert.equal(summary.test, true);
  assert.equal(summary.phoneNumberId, "597907523413541");
  assert.equal(summary.message.id, "wamid.TEST");
  assert.equal(summary.message.type, "text");
  assert.equal(summary.message.from, "+15551234567");
  assert.equal(summary.message.textPreview, "This is a test message from Kapso webhook testing");
  assert.equal(summary.conversation.id, "test-conv");
  assert.equal(summary.conversation.phoneNumber, "+15551234567");
});

test("extractMessage accepts nested location payloads", () => {
  const message = extractMessage({
    contact: {
      phone: "+573001234567",
    },
    message: {
      location: {
        latitude: 5.535,
        longitude: -73.367,
        address: "Centro",
      },
    },
  });

  assert.equal(message.phone, "+573001234567");
  assert.deepEqual(message.location, {
    lat: 5.535,
    lng: -73.367,
    address: "Centro",
  });
});

test("intent helpers recognize MVP commands", () => {
  assert.equal(isTaxiIntent("quiero un taxi"), true);
  assert.equal(isTaxiIntent("hola"), false);
  assert.equal(isConfirmation("SI"), true);
  assert.equal(isConfirmation("no"), false);
});

test("verifyKapsoWebhook accepts valid signatures", () => {
  const payload = { from: "+573001234567", body: "Taxi" };

  assert.equal(verifyKapsoWebhook(payload, signPayload(payload), SECRET), true);
});

test("verifyKapsoWebhook rejects invalid signatures", () => {
  const payload = { from: "+573001234567", body: "Taxi" };

  assert.equal(verifyKapsoWebhook(payload, "bad-signature", SECRET), false);
});

test("verifyKapsoWebhook rejects missing signatures", () => {
  const payload = { from: "+573001234567", body: "Taxi" };

  assert.equal(verifyKapsoWebhook(payload, null, SECRET), false);
});

test("processKapsoWebhookRequest ignores unrelated events", async (t) => {
  const calls = installConversationStubs(t);
  const payload = { from: "+573001234567", body: "Taxi" };

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers: buildHeaders(payload, {
      "x-webhook-event": "whatsapp.phone_number.created",
      "x-webhook-signature": null,
    }),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ignored, true);
  assert.equal(calls.reserved.length, 0);
  assert.equal(calls.sessions.length, 0);
});

test("processKapsoWebhookRequest rejects invalid signatures", async (t) => {
  const calls = installConversationStubs(t);
  const payload = { from: "+573001234567", body: "Taxi" };

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers: buildHeaders(payload, {
      "x-webhook-signature": signPayload({ different: true }),
    }),
  });

  assert.equal(result.statusCode, 401);
  assert.equal(result.body.message, "Invalid signature");
  assert.equal(calls.reserved.length, 0);
});

test("processKapsoWebhookRequest rejects missing signature headers", async (t) => {
  const calls = installConversationStubs(t);
  const payload = { from: "+573001234567", body: "Taxi" };

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers: buildHeaders(payload, {
      "x-webhook-signature": null,
    }),
  });

  assert.equal(result.statusCode, 401);
  assert.equal(result.body.message, "Invalid signature");
  assert.equal(calls.reserved.length, 0);
});

test("processKapsoWebhookRequest stores Kapso test payloads with a test phone", async (t) => {
  const calls = installConversationStubs(t);
  const payload = {
    test: true,
    message: {
      id: "wamid.TEST",
      from: "+15551234567",
      text: {
        body: "This is a test message from Kapso webhook testing",
      },
      type: "text",
      username: "kapso_test_user",
    },
    conversation: {
      id: "test-conv",
      username: "kapso_test_user",
      contact_name: "kapso_test_user",
      phone_number: "+15551234567",
    },
  };

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers: buildHeaders(payload, {
      "x-idempotency-key": "kapso-test-key",
    }),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.state, "START");
  assert.equal(calls.reserved.length, 1);
  assert.deepEqual(calls.markedProcessed, ["kapso-test-key"]);
  assert.equal(calls.sessions.length, 1);
  assert.equal(calls.sessions[0].phone, "t+15551234567");
  assert.equal(calls.sessions[0].userId, null);
  assert.equal(calls.sessions[0].context.kapsoTest, true);
  assert.equal(calls.sessions[0].context.realPhone, "+15551234567");
  assert.equal(calls.sessions[0].context.kapsoConversationId, "test-conv");
  assert.equal(calls.sessions[0].context.kapsoUsername, "kapso_test_user");
  assert.equal(calls.createdRides.length, 0);
});

test("processKapsoWebhookRequest reserves and marks a new idempotency key", async (t) => {
  const calls = installConversationStubs(t);
  const payload = { from: "+573001234567", body: "Taxi" };
  const headers = buildHeaders(payload, {
    "x-idempotency-key": "new-key",
  });

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.state, "WAITING_PICKUP");
  assert.deepEqual(calls.reserved, [
    {
      idempotencyKey: "new-key",
      eventType: KAPSO_MESSAGE_RECEIVED_EVENT,
    },
  ]);
  assert.deepEqual(calls.markedProcessed, ["new-key"]);
});

test("processKapsoWebhookRequest skips duplicate idempotency keys", async (t) => {
  const calls = installConversationStubs(t, { duplicate: true });
  const payload = { from: "+573001234567", body: "Taxi" };

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers: buildHeaders(payload, {
      "x-idempotency-key": "duplicate-key",
    }),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(calls.sessions.length, 0);
  assert.equal(calls.createdRides.length, 0);
  assert.equal(calls.markedProcessed.length, 0);
});

test("a repeated confirmation event does not create two rides", async (t) => {
  const calls = installConversationStubs(t, {
    initialSession: {
      id: "session-1",
      phone: "+573001234567",
      userId: "client-1",
      state: "WAITING_CONFIRMATION",
      context: {
        serviceType: "standard",
        pickupLat: 5.535,
        pickupLng: -73.367,
        pickupAddress: "Centro",
      },
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  let reserved = false;
  WhatsappWebhookEventModel.reserveIdempotencyKey = async (event) => {
    calls.reserved.push(event);
    if (reserved) {
      return { reserved: false, event: null };
    }
    reserved = true;
    return { reserved: true, event: { id: "event-1", ...event } };
  };

  const payload = { from: "+573001234567", body: "SI" };
  const headers = buildHeaders(payload, {
    "x-idempotency-key": "same-confirmation",
  });

  const first = await KapsoWhatsappService.processKapsoWebhookRequest({ payload, headers });
  const second = await KapsoWhatsappService.processKapsoWebhookRequest({ payload, headers });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(calls.createdRides.length, 1);
});

test("shared pickup location moves directly to confirmation", async (t) => {
  const calls = installConversationStubs(t, {
    initialSession: {
      id: "session-1",
      phone: "+573001234567",
      userId: "client-1",
      state: "WAITING_PICKUP",
      context: { serviceType: "standard" },
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const payload = {
    from: "+573001234567",
    message: {
      location: {
        latitude: 5.535,
        longitude: -73.367,
        address: "Centro",
      },
    },
  };

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers: buildHeaders(payload),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.state, "WAITING_CONFIRMATION");
  assert.equal(calls.sessions.at(-1).context.pickupLat, 5.535);
  assert.equal(calls.sessions.at(-1).context.pickupLng, -73.367);
});

test("confirmation SI creates a whatsapp ride without destination", async (t) => {
  const calls = installConversationStubs(t, {
    initialSession: {
      id: "session-1",
      phone: "+573001234567",
      userId: "client-1",
      state: "WAITING_CONFIRMATION",
      context: {
        serviceType: "standard",
        pickupLat: 5.535,
        pickupLng: -73.367,
        pickupAddress: "Centro",
      },
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const payload = { from: "+573001234567", body: "SI" };

  const result = await KapsoWhatsappService.processKapsoWebhookRequest({
    payload,
    headers: buildHeaders(payload),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.rideId, "ride-1");
  assert.equal(calls.createdRides.length, 1);
  assert.equal(calls.createdRides[0].source, "whatsapp");
  assert.equal(calls.createdRides[0].hasDestination, false);
});
