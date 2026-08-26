const axios = require("axios");

const { logger } = require("../../../config/logger");

const KAPSO_API_BASE_URL = process.env.KAPSO_API_BASE_URL || "https://api.kapso.ai";

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeWhatsappRecipient(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

async function sendWhatsappText({ phoneNumberId, to, body }) {
  const apiKey = process.env.KAPSO_API_KEY;
  const recipient = normalizeWhatsappRecipient(to);

  if (!apiKey) {
    logger.warn("kapso_outbound_skipped", {
      reason: "missing_api_key",
      phoneNumberId: phoneNumberId || null,
      hasRecipient: Boolean(recipient),
      hasBody: Boolean(body),
    });
    return {
      skipped: true,
      reason: "missing_api_key",
    };
  }

  if (!phoneNumberId) {
    throw createHttpError(400, "phoneNumberId is required to send Kapso WhatsApp messages.");
  }

  if (!recipient) {
    throw createHttpError(400, "Recipient phone is required to send Kapso WhatsApp messages.");
  }

  if (!body) {
    throw createHttpError(400, "Message body is required to send Kapso WhatsApp messages.");
  }

  const response = await axios.post(
    `${KAPSO_API_BASE_URL}/meta/whatsapp/v24.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: {
        body,
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      timeout: 10000,
    }
  );

  logger.info("kapso_outbound_message_sent", {
    phoneNumberId,
    to: recipient,
    status: response.status,
  });

  return {
    skipped: false,
    status: response.status,
    data: response.data,
  };
}

module.exports = {
  sendWhatsappText,
  __private: {
    normalizeWhatsappRecipient,
  },
};
