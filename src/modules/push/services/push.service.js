const Queue = require("../models/push-delivery.model");
const { env } = require("../../../config");
const { logger } = require("../../../config/logger");

const TYPES = new Set(["ride.invite", "ride.status", "driver.panic", "message.important"]);
function normalize(notification) {
  if (!notification || !TYPES.has(notification.type) || typeof notification.eventId !== "string" ||
      !notification.eventId.length || notification.eventId.length > 200 ||
      typeof notification.title !== "string" || notification.title.length > 120 ||
      typeof notification.body !== "string" || notification.body.length > 500) throw new Error("Invalid push notification.");
  const expiresAt = new Date(notification.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() > Date.now() + 3600000) throw new Error("Invalid push expiry.");
  // Whitelist fields; never copy an arbitrary business object into an FCM payload.
  const result = { eventId: notification.eventId, type: notification.type, title: notification.title,
    body: notification.body, expiresAt: expiresAt.toISOString(), schemaVersion: "1" };
  for (const key of ["rideId", "inviteId", "invitedAt", "status", "sourceEventId", "notificationId"]) {
    if (notification[key] !== undefined && notification[key] !== null) result[key] = String(notification[key]);
  }
  if (result.type === "ride.invite" && (!result.inviteId || !result.invitedAt || !result.rideId)) throw new Error("Missing invitation identity.");
  if (result.type === "ride.status" && (!result.rideId || !result.status || !result.sourceEventId)) throw new Error("Missing ride event identity.");
  if (result.type === "driver.panic" && !result.notificationId) throw new Error("Missing panic identity.");
  return result;
}
async function sendToUsers(userIds, notification, deviceId = null) {
  if (!env.push.enabled) return { queued: 0, disabled: true };
  try {
    const payload = normalize(notification);
    if (Date.parse(payload.expiresAt) <= Date.now() || !userIds.length) return { queued: 0 };
    return { queued: await Queue.enqueue([...new Set(userIds)], payload, deviceId) };
  } catch {
    logger.warn("push_enqueue_failed", { reason: "queue_or_payload_unavailable" });
    return { queued: 0, failed: true };
  }
}
async function sendToUser(userId, notification) { return sendToUsers([userId], notification); }
async function sendToDevice(deviceId, notification) {
  if (!env.push.enabled) return { queued: 0, disabled: true };
  try {
    const owner = await Queue.deviceOwner(deviceId);
    return owner ? sendToUsers([owner], notification, deviceId) : { queued: 0 };
  } catch { return { queued: 0, failed: true }; }
}
module.exports = { sendToUser, sendToUsers, sendToDevice, normalize };
