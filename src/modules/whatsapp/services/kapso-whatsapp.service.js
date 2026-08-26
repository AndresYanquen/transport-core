const crypto = require("crypto");

const { logger } = require("../../../config/logger");
const KapsoClient = require("./kapso-client.service");
const WhatsappBotService = require("./whatsapp-bot.service");
const WhatsappWebhookEventModel = require("../models/whatsapp-webhook-event.model");

const KAPSO_MESSAGE_RECEIVED_EVENT = "whatsapp.message.received";

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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

async function handleKapsoWebhook(payload) {
  const message = extractMessage(payload);
  return WhatsappBotService.handleMessage({
    payload,
    message,
  });
}

async function handleKapsoTestWebhook(payload) {
  const message = extractMessage(payload);
  return WhatsappBotService.handleTestMessage({
    payload,
    message,
  });
}

function getKapsoPhoneNumberId(payload = {}) {
  return (
    payload.phone_number_id ||
    payload.conversation?.phone_number_id ||
    payload.message?.phone_number_id ||
    payload.data?.phone_number_id ||
    null
  );
}

function getKapsoReplyRecipient(payload = {}) {
  const message = extractMessage(payload);
  return message.phone;
}

async function sendKapsoReply({ payload, result }) {
  if (!result?.reply) {
    return null;
  }

  const phoneNumberId = getKapsoPhoneNumberId(payload);
  const to = getKapsoReplyRecipient(payload);
  try {
    const response = await KapsoClient.sendWhatsappText({
      phoneNumberId,
      to,
      body: result.reply,
    });

    return response;
  } catch (error) {
    logger.error("kapso_outbound_message_failed", {
      phoneNumberId: phoneNumberId || null,
      hasRecipient: Boolean(to),
      error,
    });
    return {
      skipped: true,
      reason: "send_failed",
    };
  }
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
          const outbound = await sendKapsoReply({
            payload: eventPayload,
            result: eventResult,
          });
          processedCount += 1;
          results.push({
            ok: true,
            state: eventResult.state ?? null,
            rideId: eventResult.rideId ?? null,
            outboundSkipped: outbound?.skipped ?? false,
          });
        } catch (error) {
          failedCount += 1;
          logger.warn("kapso_batch_event_failed", {
            eventType,
            idempotencyKey,
            eventIndex: results.length,
            payload: summarizeKapsoPayload(eventPayload),
            error: {
              name: error.name,
              message: error.message,
              status: error.status || null,
            },
          });
          results.push({
            ok: false,
            message: error.message,
            status: error.status || null,
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
      await sendKapsoReply({
        payload,
        result,
      });
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
    isTaxiIntent: WhatsappBotService.__private.isTaxiIntent,
    isConfirmation: WhatsappBotService.__private.isConfirmation,
    verifyKapsoWebhook,
    isKapsoTestPayload,
    buildKapsoTestPhone: WhatsappBotService.__private.buildKapsoTestPhone,
    buildKapsoTestContext: WhatsappBotService.__private.buildKapsoTestContext,
    summarizeKapsoPayload,
    extractKapsoBatchEvents,
    getKapsoPhoneNumberId,
    getKapsoReplyRecipient,
    sendKapsoReply,
    KAPSO_MESSAGE_RECEIVED_EVENT,
    STATES: WhatsappBotService.__private.STATES,
  },
};
