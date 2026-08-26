const crypto = require("crypto");

const { logger } = require("../../../config/logger");
const AuthModel = require("../../auth/models/auth.model");
const { normalizePhoneNumber } = require("../../auth/utils/phone");
const RideService = require("../../rides/services/ride.service");
const WhatsappSessionModel = require("../models/whatsapp-session.model");
const WhatsappWebhookEventModel = require("../models/whatsapp-webhook-event.model");

const SESSION_TTL_MS = 30 * 60 * 1000;
const KAPSO_MESSAGE_RECEIVED_EVENT = "whatsapp.message.received";
const STATES = {
  START: "START",
  WAITING_PICKUP: "WAITING_PICKUP",
  WAITING_CONFIRMATION: "WAITING_CONFIRMATION",
};

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function expiresAt() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

function pickFirstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

function extractLocation(payload = {}) {
  const location =
    payload.location ||
    payload.message?.location ||
    payload.data?.location ||
    payload.contact?.location ||
    null;

  if (!location) return null;

  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.lon ?? location.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    address: pickFirstString(
      location.address,
      location.name,
      payload.address,
      payload.message?.address
    ),
  };
}

function extractMessage(payload = {}) {
  return {
    phone: pickFirstString(
      payload.conversation?.phone_number,
      payload.phone,
      payload.from,
      payload.sender,
      payload.contact?.phone,
      payload.contact?.wa_id,
      payload.message?.from,
      payload.data?.from
    ),
    text: pickFirstString(
      payload.text,
      payload.body,
      payload.message?.text?.body,
      payload.message?.text,
      payload.message?.body,
      payload.data?.text,
      payload.data?.text?.body,
      payload.data?.body
    ),
    location: extractLocation(payload),
    raw: payload,
  };
}

function isKapsoTestPayload(payload = {}) {
  return payload.test === true;
}

function truncateForLog(value, maxLength = 160) {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeKapsoPayload(payload = {}) {
  const message = extractMessage(payload);

  return {
    topLevelKeys: Object.keys(payload).sort(),
    test: isKapsoTestPayload(payload),
    phoneNumberId: payload.phone_number_id || payload.conversation?.phone_number_id || null,
    isNewConversation:
      typeof payload.is_new_conversation === "boolean"
        ? payload.is_new_conversation
        : null,
    message: {
      id: payload.message?.id || payload.id || payload.data?.id || null,
      type: payload.message?.type || payload.type || payload.data?.type || null,
      from: message.phone || null,
      textPreview: truncateForLog(message.text),
      hasText: Boolean(message.text),
      hasLocation: Boolean(message.location),
      location: message.location
        ? {
            lat: message.location.lat,
            lng: message.location.lng,
            hasAddress: Boolean(message.location.address),
          }
        : null,
      timestamp: payload.message?.timestamp || payload.timestamp || payload.data?.timestamp || null,
      kapso: payload.message?.kapso || payload.kapso || null,
    },
    conversation: payload.conversation
      ? {
          id: payload.conversation.id || null,
          status: payload.conversation.status || null,
          username: payload.conversation.username || null,
          contactName: payload.conversation.contact_name || null,
          phoneNumber: payload.conversation.phone_number || null,
          messagesCount: payload.conversation.kapso?.messages_count ?? null,
          lastActiveAt: payload.conversation.last_active_at || null,
        }
      : null,
  };
}

function extractKapsoBatchEvents(payload = {}) {
  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.data?.events)) {
    return payload.data.events;
  }

  if (Array.isArray(payload.data?.messages)) {
    return payload.data.messages;
  }

  return null;
}

function buildKapsoTestPhone(phone) {
  return phone ? `t${phone}` : null;
}

function buildKapsoTestContext(payload = {}, message = {}) {
  return {
    kapsoTest: true,
    realPhone: message.phone || null,
    kapsoConversationId: payload.conversation?.id || null,
    kapsoUsername:
      payload.conversation?.username ||
      payload.message?.username ||
      null,
    kapsoContactName: payload.conversation?.contact_name || null,
    kapsoMessageId: payload.message?.id || null,
    lastText: message.text || null,
  };
}

function verifyKapsoWebhook(payload, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

function isTaxiIntent(text = "") {
  return /\b(taxi|carro|viaje|servicio)\b/i.test(text);
}

function isConfirmation(text = "") {
  return /^(si|sí|confirmo|confirmar|ok|dale|listo|1)$/i.test(text.trim());
}

async function ensureWhatsappClient(phone) {
  const existingClient = await AuthModel.findClientByPhoneNumber(phone);
  if (existingClient) {
    return {
      client: existingClient,
      created: false,
    };
  }

  const client = await AuthModel.createPhoneOnlyClient({
    phoneNumber: phone,
    firstName: "WhatsApp",
    lastName: null,
    createdByOperatorId: null,
    source: "whatsapp",
  });

  return {
    client,
    created: true,
  };
}

function buildResponse({ reply, session, ride = null }) {
  return {
    reply,
    state: session?.state ?? null,
    rideId: ride?.id ?? null,
  };
}

async function handleKapsoWebhook(payload) {
  const message = extractMessage(payload);
  if (!message.phone) {
    throw createHttpError(400, "Kapso WhatsApp payload must include sender phone.");
  }

  const phone = normalizePhoneNumber(message.phone);
  const { client, created } = await ensureWhatsappClient(phone);
  const existingSession = await WhatsappSessionModel.findByPhone(phone);
  const session =
    existingSession && new Date(existingSession.expiresAt).getTime() > Date.now()
      ? existingSession
      : await WhatsappSessionModel.resetSession({
          phone,
          userId: client.id,
          expiresAt: expiresAt(),
        });

  if (created) {
    session.context.phoneOnlyClientCreated = true;
  }

  const text = message.text || "";

  if (session.state === STATES.START) {
    if (!isTaxiIntent(text)) {
      const nextSession = await WhatsappSessionModel.upsertSession({
        phone,
        userId: client.id,
        state: STATES.START,
        context: {},
        expiresAt: expiresAt(),
      });

      return buildResponse({
        session: nextSession,
        reply: "Hola. Responde Taxi para pedir un servicio.",
      });
    }

    const nextSession = await WhatsappSessionModel.upsertSession({
      phone,
      userId: client.id,
      state: STATES.WAITING_PICKUP,
      context: { serviceType: "standard" },
      expiresAt: expiresAt(),
    });

    return buildResponse({
      session: nextSession,
      reply: "Listo. Comparte tu ubicacion de origen por WhatsApp.",
    });
  }

  if (session.state === STATES.WAITING_PICKUP) {
    if (!message.location) {
      return buildResponse({
        session,
        reply: "Necesito la ubicacion de origen. Usa compartir ubicacion en WhatsApp.",
      });
    }

    const nextSession = await WhatsappSessionModel.upsertSession({
      phone,
      userId: client.id,
      state: STATES.WAITING_CONFIRMATION,
      context: {
        ...session.context,
        pickupLat: message.location.lat,
        pickupLng: message.location.lng,
        pickupAddress: message.location.address || "Ubicacion compartida por WhatsApp",
      },
      expiresAt: expiresAt(),
    });

    return buildResponse({
      session: nextSession,
      reply: `Recibido. Confirma tu taxi desde ${nextSession.context.pickupAddress}. Responde SI para confirmar.`,
    });
  }

  if (session.state === STATES.WAITING_CONFIRMATION) {
    if (!isConfirmation(text)) {
      return buildResponse({
        session,
        reply: "Servicio pendiente de confirmacion. Responde SI para confirmar o Taxi para empezar de nuevo.",
      });
    }

    const rideResult = await RideService.createRide({
      clientId: client.id,
      serviceType: session.context.serviceType || "standard",
      pickupAddress: session.context.pickupAddress || "Ubicacion compartida por WhatsApp",
      pickupLocation: {
        lat: session.context.pickupLat,
        lng: session.context.pickupLng,
      },
      requestDescription: session.context.dropoffAddress
        ? `Destino WhatsApp: ${session.context.dropoffAddress}`
        : null,
      hasDestination: false,
      source: "whatsapp",
      actorType: "client",
      actorId: client.id,
      metadata: {
        source: "whatsapp",
        provider: "kapso",
        phone,
        dropoffAddressText: session.context.dropoffAddress || null,
        rawMessage: message.raw,
      },
    });

    const nextSession = await WhatsappSessionModel.resetSession({
      phone,
      userId: client.id,
      expiresAt: expiresAt(),
    });

    logger.info("kapso_ride_created", {
      rideId: rideResult.ride.id,
      phone,
      source: "whatsapp",
    });

    return buildResponse({
      session: nextSession,
      ride: rideResult.ride,
      reply: `Servicio creado. Estamos buscando conductor. ID: ${rideResult.ride.id}`,
    });
  }

  const nextSession = await WhatsappSessionModel.resetSession({
    phone,
    userId: client.id,
    expiresAt: expiresAt(),
  });

  return buildResponse({
    session: nextSession,
    reply: "Reiniciamos la conversacion. Responde Taxi para pedir un servicio.",
  });
}

async function handleKapsoTestWebhook(payload) {
  const message = extractMessage(payload);
  if (!message.phone) {
    throw createHttpError(400, "Kapso test payload must include sender phone.");
  }

  const phone = buildKapsoTestPhone(message.phone);
  const nextSession = await WhatsappSessionModel.upsertSession({
    phone,
    userId: null,
    state: STATES.START,
    context: buildKapsoTestContext(payload, message),
    expiresAt: expiresAt(),
  });

  return buildResponse({
    session: nextSession,
    reply: "Kapso test payload received.",
  });
}

function getHeader(headers = {}, name) {
  const normalizedName = name.toLowerCase();
  return headers[name] || headers[normalizedName] || null;
}

async function processKapsoWebhookRequest({ payload, headers = {} }) {
  const eventType = getHeader(headers, "x-webhook-event");
  const signature = getHeader(headers, "x-webhook-signature");
  const idempotencyKey = getHeader(headers, "x-idempotency-key");
  const payloadVersion = getHeader(headers, "x-webhook-payload-version");
  const isBatch = String(getHeader(headers, "x-webhook-batch") || "").toLowerCase() === "true";
  const batchEvents = isBatch ? extractKapsoBatchEvents(payload) : null;

  logger.info("kapso_webhook_received", {
    eventType,
    hasSignature: Boolean(signature),
    hasIdempotencyKey: Boolean(idempotencyKey),
    payloadVersion: payloadVersion || null,
    isBatch,
  });
  logger.info("kapso_whatsapp_payload_received", {
    eventType,
    idempotencyKey: idempotencyKey || null,
    payloadVersion: payloadVersion || null,
    isBatch,
    payload: summarizeKapsoPayload(payload),
  });
  if (isBatch) {
    logger.info("kapso_batch_received", {
      eventType,
      idempotencyKey: idempotencyKey || null,
      payloadVersion: payloadVersion || null,
      batchSize: Array.isArray(batchEvents) ? batchEvents.length : null,
      malformed: !Array.isArray(batchEvents),
    });
  }

  if (eventType !== KAPSO_MESSAGE_RECEIVED_EVENT) {
    return {
      statusCode: 200,
      body: {
        ignored: true,
        eventType,
      },
    };
  }

  const validSignature = verifyKapsoWebhook(
    payload,
    signature,
    process.env.KAPSO_WEBHOOK_SECRET
  );

  if (!validSignature) {
    logger.warn("kapso_webhook_invalid_signature", {
      eventType,
      hasSignature: Boolean(signature),
      signatureLength: signature ? String(signature).length : 0,
    });

    return {
      statusCode: 401,
      body: {
        message: "Invalid signature",
      },
    };
  }

  if (isKapsoTestPayload(payload)) {
    if (!idempotencyKey) {
      throw createHttpError(400, "X-Idempotency-Key header is required.");
    }
  }

  if (!idempotencyKey) {
    throw createHttpError(400, "X-Idempotency-Key header is required.");
  }

  if (isBatch && !Array.isArray(batchEvents)) {
    throw createHttpError(400, "Kapso batch payload data must be an array.");
  }

  const reservation = await WhatsappWebhookEventModel.reserveIdempotencyKey({
    idempotencyKey,
    eventType,
  });

  if (!reservation.reserved) {
    logger.info("kapso_webhook_duplicate", {
      eventType,
      idempotencyKey,
    });

    return {
      statusCode: 200,
      body: {
        duplicate: true,
      },
    };
  }

  try {
    logger.info("kapso_message_received", {
      eventType,
      idempotencyKey,
      payloadVersion: payloadVersion || null,
      isBatch,
      test: isKapsoTestPayload(payload),
    });

    let result;
    if (isBatch) {
      const results = [];
      let processedCount = 0;
      let failedCount = 0;

      for (const eventPayload of batchEvents) {
        try {
          const eventResult = isKapsoTestPayload(eventPayload)
            ? await handleKapsoTestWebhook(eventPayload)
            : await handleKapsoWebhook(eventPayload);
          processedCount += 1;
          results.push({
            ok: true,
            state: eventResult.state ?? null,
            rideId: eventResult.rideId ?? null,
          });
        } catch (error) {
          failedCount += 1;
          results.push({
            ok: false,
            message: error.message,
          });
        }
      }

      logger.info("kapso_batch_processed", {
        eventType,
        idempotencyKey,
        batchSize: batchEvents.length,
        processedCount,
        failedCount,
      });

      if (failedCount > 0) {
        throw createHttpError(
          400,
          `Kapso batch processing failed for ${failedCount} event(s).`
        );
      }

      result = {
        batch: true,
        batchSize: batchEvents.length,
        processedCount,
        failedCount,
        results,
      };
    } else {
      result = isKapsoTestPayload(payload)
        ? await handleKapsoTestWebhook(payload)
        : await handleKapsoWebhook(payload);
    }
    await WhatsappWebhookEventModel.markProcessed(idempotencyKey);

    return {
      statusCode: 200,
      body: result,
    };
  } catch (error) {
    await WhatsappWebhookEventModel.releaseReservation(idempotencyKey);
    logger.error("kapso_webhook_processing_failed", {
      eventType,
      idempotencyKey,
      error,
    });
    throw error;
  }
}

module.exports = {
  handleKapsoWebhook,
  processKapsoWebhookRequest,
  __private: {
    extractMessage,
    isTaxiIntent,
    isConfirmation,
    verifyKapsoWebhook,
    isKapsoTestPayload,
    buildKapsoTestPhone,
    buildKapsoTestContext,
    summarizeKapsoPayload,
    extractKapsoBatchEvents,
    KAPSO_MESSAGE_RECEIVED_EVENT,
    STATES,
  },
};
