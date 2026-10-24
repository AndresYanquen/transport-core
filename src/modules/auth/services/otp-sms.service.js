const crypto = require("node:crypto");
const { env } = require("../../../config");
const Inalambria = require("./inalambria-sms.service");

// Development-only, bounded, ephemeral outbox; no codes in SQL, logs or HTTP.
const outbox = new Map();

function assertConfigured() {
  const config = env.phoneAuth;
  if (!config.enabled || config.hashSecret.length < 32 ||
      !["inalambria", "mock"].includes(config.smsProvider) ||
      !Number.isInteger(config.rolloutPercent) || config.rolloutPercent < 0 || config.rolloutPercent > 100 ||
      !Number.isInteger(config.globalDailyLimit) || config.globalDailyLimit < 1 ||
      !Number.isInteger(config.globalMinuteLimit) || config.globalMinuteLimit < 1 ||
      (config.smsProvider === "mock" && !["development", "test"].includes(env.nodeEnv))) {
    throw Object.assign(new Error("Phone authentication is unavailable."), { status: 503 });
  }
  if (config.smsProvider === "inalambria") Inalambria.assertConfigured();
}

function assertRolloutAllowed(phone) {
  const config = env.phoneAuth;
  const bucket = crypto.createHmac("sha256", config.hashSecret).update(`rollout:${phone}`).digest().readUInt32BE(0) % 100;
  if (!config.allowedNumbers.includes(phone) && bucket >= config.rolloutPercent) {
    throw Object.assign(new Error("Phone authentication is unavailable."), { status: 503 });
  }
}

async function sendOtp(payload) {
  assertConfigured();
  if (env.phoneAuth.smsProvider === "inalambria") {
    // Prevent accidental real SMS from Node's automated test runner.
    if (process.env.NODE_TEST_CONTEXT || env.nodeEnv === "test") {
      throw Object.assign(new Error("Real SMS is disabled during automated tests."), { status: 503 });
    }
    return Inalambria.sendOtp(payload);
  }
  for (const [phone, message] of outbox) if (message.expiresAt <= Date.now()) outbox.delete(phone);
  if (outbox.size >= 1000) outbox.delete(outbox.keys().next().value);
  outbox.set(payload.phoneNumber, { code: payload.code, expiresAt: Date.now() + env.phoneAuth.ttlSeconds * 1000 });
  return { providerReference: `mock:${crypto.randomUUID()}` };
}

function takeMockOtp(phone) {
  if (env.phoneAuth.smsProvider !== "mock" || !["development", "test"].includes(env.nodeEnv)) {
    throw new Error("Mock SMS access is unavailable.");
  }
  const message = outbox.get(phone);
  outbox.delete(phone);
  return message && message.expiresAt > Date.now() ? message.code : null;
}

module.exports = { assertConfigured, assertRolloutAllowed, sendOtp, takeMockOtp };
