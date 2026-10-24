const axios = require("axios");
const { env } = require("../../../config");
const { logger } = require("../../../config/logger");

function assertConfigured() {
  if (!env.phoneAuth.enabled || env.phoneAuth.hashSecret.length < 32 || !env.inalambria.apiKey ||
      !Number.isInteger(env.phoneAuth.globalDailyLimit) || env.phoneAuth.globalDailyLimit < 1 ||
      !Number.isInteger(env.phoneAuth.globalMinuteLimit) || env.phoneAuth.globalMinuteLimit < 1) {
    const error = new Error("Phone authentication is unavailable.");
    error.status = 503;
    throw error;
  }
}

async function sendOtp({ phoneNumber, code }) {
  assertConfigured();
  try {
    const response = await axios.post("https://api.inalambria.express/v1/messages/send", {
      content: `GotTaxi: tu codigo de acceso es ${code}. Vence en 5 minutos. No lo compartas.`,
      recipients: [phoneNumber],
      async: false,
      flashSms: false,
    }, {
      headers: { Authorization: `Bearer ${env.inalambria.apiKey}`, "Content-Type": "application/json" },
      timeout: env.inalambria.timeoutMs,
      maxRedirects: 0,
    });
    // A successful HTTP response alone is not proof of provider acceptance.
    if (response.status !== 200 || response.data?.ok !== true || response.data?.messages !== 1 ||
        typeof response.data?.consumptionId !== "string" || !response.data.consumptionId || response.data.consumptionId.length > 128) {
      throw Object.assign(new Error("Provider did not accept the SMS."), { response: { status: response.status } });
    }
    return { providerReference: response.data.consumptionId };
  } catch (cause) {
    // Axios errors include the API key and SMS body; never propagate or log them.
    logger.warn("phone_otp_sms_failed", { provider: "inalambria", status: cause.response?.status || null });
    const error = new Error("Unable to send verification code. Please try again later.");
    error.status = 503;
    const providerStatus = cause.response?.status;
    error.deliveryUnknown = !providerStatus || providerStatus >= 500 || providerStatus === 408 ||
      (providerStatus >= 200 && providerStatus < 300);
    error.blockProvider = [401, 402, 403, 429].includes(providerStatus);
    throw error;
  }
}

module.exports = { sendOtp, assertConfigured };
