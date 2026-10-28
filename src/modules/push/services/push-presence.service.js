const Devices = require("../models/push-device.model");
const Queue = require("../models/push-delivery.model");
const DeviceService = require("./push-device.service");
const { logger } = require("../../../config/logger");
const INVITATION_EVENT = /^invite:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/i;
function error(status, message) { return Object.assign(new Error(message), { status }); }
async function context(auth, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw error(400, "A JSON object is required.");
  if (auth.role !== "driver" || !auth.payload.sid) throw error(403, "An authenticated driver installation session is required.");
  return { ...await DeviceService.context(auth, body.installationId), userId: auth.userId };
}
async function reportVisibility(auth, body = {}) {
  const ctx = await context(auth, body);
  if (!["foreground", "background", "unknown"].includes(body.visibility)) throw error(400, "visibility must be foreground, background or unknown.");
  return Devices.reportVisibility({ ...ctx, visibility: body.visibility });
}
async function acknowledgePresentation(auth, body = {}) {
  const ctx = await context(auth, body);
  if (body.visibility !== "foreground") throw error(400, "Confirm only an invitation presented in foreground.");
  if (typeof body.eventId !== "string" || !INVITATION_EVENT.test(body.eventId)) throw error(400, "A valid invitation eventId is required.");
  const result = await Queue.acknowledgePresentation({ ...ctx, eventId: body.eventId });
  logger.info("push_invitation_presentation", { eventId: body.eventId, recorded: result.recorded, suppressed: result.suppressed });
  return result;
}
module.exports = { reportVisibility, acknowledgePresentation };
