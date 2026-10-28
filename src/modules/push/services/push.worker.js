const Queue = require("../models/push-delivery.model");
const Devices = require("../models/push-device.model");
const Firebase = require("../../../config/firebase");
const { env } = require("../../../config");
const { logger } = require("../../../config/logger");
const RETRYABLE = new Set(["messaging/server-unavailable", "messaging/internal-error", "messaging/unknown-error",
  "messaging/quota-exceeded", "messaging/message-rate-exceeded", "messaging/device-message-rate-exceeded",
  "app/network-error", "app/network-timeout", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]);
const INVALID = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
const SAFE_CODES = new Set([...RETRYABLE, ...INVALID, "messaging/invalid-argument", "messaging/invalid-payload",
  "messaging/authentication-error", "messaging/mismatched-credential", "messaging/third-party-auth-error"]);
let timer = null;
let inFlight = null;
let lastCleanup = 0;
const metrics = { accepted: 0, failed: 0, retried: 0, discarded: 0 };
function buildMessage(job, token, now = Date.now()) {
  const { title, body, ...data } = job.payload;
  const ttl = Math.max(0, Date.parse(job.expires_at) - now);
  const urgent = job.payload.type === "ride.invite" || job.payload.type === "driver.panic";
  return { token, notification: { title, body }, data,
    android: { priority: urgent ? "high" : "normal", ttl,
      notification: { tag: job.event_id } },
    apns: { headers: { "apns-expiration": String(Math.floor(Date.parse(job.expires_at) / 1000)),
      "apns-priority": urgent ? "10" : "5", "apns-push-type": "alert" },
      payload: { aps: { sound: "default" } } },
    webpush: { headers: { TTL: String(Math.floor(ttl / 1000)), Urgency: urgent ? "high" : "normal" },
      notification: { tag: job.event_id } } };
}
function errorPolicy(error, attempt, now = Date.now()) {
  const rawCode = error?.code;
  const code = SAFE_CODES.has(rawCode) ? rawCode : "provider-error";
  // INVALID_ARGUMENT is also a malformed payload: never disable on that ambiguous code.
  const retryable = RETRYABLE.has(rawCode);
  let retryAfter = error?.httpResponse?.headers?.["retry-after"];
  let retrySeconds = Number(retryAfter);
  if (!Number.isFinite(retrySeconds)) retrySeconds = Math.max(0, (Date.parse(retryAfter) - now) / 1000) || 0;
  const delaySeconds = Math.max(retrySeconds || 0, Math.min(900, 60 * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 15));
  return { code, invalid: INVALID.has(rawCode), retryable, delaySeconds };
}
async function processResult(job, result) {
  if (result.success) {
    await Queue.finish(job, { status: "accepted", messageId: result.messageId });
    metrics.accepted++;
    return;
  }
  const policy = errorPolicy(result.error, job.attempts);
  if (policy.invalid) await Devices.disableInvalidToken(job.device_id, job.registration_version);
  const retry = policy.retryable && job.attempts < env.push.maxAttempts &&
    Date.now() + policy.delaySeconds * 1000 < Date.parse(job.expires_at);
  await Queue.finish(job, { status: retry ? "pending" : "failed", code: policy.code, delaySeconds: retry ? policy.delaySeconds : 0 });
  metrics[retry ? "retried" : "failed"]++;
  logger.warn("push_delivery_error", { deliveryId: job.id, code: policy.code, retry });
}
async function runBatch(messaging) {
  if (Date.now() - lastCleanup > 60000) {
    await Devices.disableRevoked();
    await Queue.cleanup(env.push.retentionDays);
    lastCleanup = Date.now();
  }
  const jobs = await Queue.claim(env.push.batchSize, env.push.maxAttempts);
  const candidates = [];
  for (const job of jobs) {
    const device = await Queue.eligibleDevice(job);
    if (!device || Date.parse(job.expires_at) <= Date.now() || !await Queue.resourceIsCurrent(job)) {
      await Queue.finish(job, { status: "discarded" });
      metrics.discarded++;
    } else { candidates.push(job); }
  }
  // The final atomic gate races safely with presentation ACKs in any API process.
  const reserved = new Map((await Queue.reserveForSend(candidates)).map((row) => [row.id, row.fcm_token]));
  const ready = [];
  for (const job of candidates) {
    if (reserved.has(job.id)) ready.push({ job, token: reserved.get(job.id) });
    else await Queue.finish(job, { status: "discarded" }); // A suppressed row is unaffected by finish's status guard.
  }
  // Mixed device-specific payloads, at most 500 messages (configured cap).
  if (ready.length) {
    let response;
    try { response = await messaging.sendEach(ready.map(({ job, token }) => buildMessage(job, token))); }
    catch (error) { response = { responses: ready.map(() => ({ success: false, error })) }; }
    for (let i = 0; i < ready.length; i++) {
      await processResult(ready[i].job, response.responses[i] || { success: false, error: { code: "messaging/internal-error" } });
    }
    logger.info("push_batch_completed", { count: ready.length, ...metrics });
  }
}
async function sweep() {
  if (inFlight || !env.push.enabled || !Firebase.getMessaging()) return;
  inFlight = runBatch(Firebase.getMessaging());
  try { await inFlight; }
  catch { logger.warn("push_worker_failed", { reason: "batch_unavailable" }); }
  finally { inFlight = null; }
}
function startPushWorker() {
  if (timer || !env.push.enabled || !Firebase.getMessaging()) return;
  timer = setInterval(sweep, env.push.intervalMs);
  timer.unref();
  void sweep();
}
async function stopPushWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  if (inFlight) await inFlight.catch(() => {});
}
module.exports = { startPushWorker, stopPushWorker, sweep, runBatch, buildMessage, errorPolicy, metrics };
