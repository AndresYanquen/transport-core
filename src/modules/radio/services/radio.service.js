const RadioModel = require("../models/radio.model");
const DriverModel = require("../../drivers/models/driver.model");
const { env } = require("../../../config");
const { emitToRole, emitToUser } = require("../../../realtime/socket.server");
const { TERMINAL_SESSION_STATUSES } = require("../constants/radio.constants");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function emitRequest(request, event = "operations:radio-request-updated") {
  emitToRole("operator", event, { request, emittedAt: new Date().toISOString() });
  emitToUser(request.driverId, `radio:request-${request.status}`, {
    request,
    emittedAt: new Date().toISOString(),
  });
}

function emitSession(session, event = "radio:session-updated") {
  const payload = { session, emittedAt: new Date().toISOString() };
  emitToUser(session.operatorId, event, payload);
  emitToUser(session.driverId, event, payload);
  emitToRole("operator", "operations:radio-session-updated", payload);
}

async function validateDriverReachable(driverId) {
  const driver = await DriverModel.getDriverById(driverId);
  if (!driver) throw httpError(404, "Driver not found.");
  const seen = new Date(driver.lastSeenAt || 0).getTime();
  if (
    !["online", "busy"].includes(driver.status) ||
    !Number.isFinite(seen) ||
    Date.now() - seen > env.driverPresence.staleAfterSeconds * 1000
  ) {
    throw httpError(409, "Driver is offline or unreachable.");
  }
  return driver;
}

async function createDriverRequest(driverId, payload = {}) {
  await validateDriverReachable(driverId);
  const existing = await RadioModel.findPendingRequestByDriver(driverId);
  if (existing) return { request: existing, idempotent: true };
  const priority = ["normal", "active_ride", "emergency"].includes(payload.priority)
    ? payload.priority
    : payload.rideId ? "active_ride" : "normal";
  const expiresAt = new Date(Date.now() + env.radio.requestTtlSeconds * 1000);
  try {
    const request = await RadioModel.createRequest({
      driverId,
      rideId: payload.rideId,
      priority,
      reason: payload.reason || "general",
      expiresAt,
    });
    emitRequest(request, "operations:radio-request-created");
    return { request, idempotent: false };
  } catch (error) {
    if (error?.code === "23505") {
      return {
        request: await RadioModel.findPendingRequestByDriver(driverId),
        idempotent: true,
      };
    }
    throw error;
  }
}

async function getMyRequest(driverId) {
  return { request: await RadioModel.findPendingRequestByDriver(driverId) };
}

async function cancelRequest(requestId, driverId) {
  const client = await RadioModel.pool.connect();
  try {
    await client.query("BEGIN");
    const request = await RadioModel.getRequest(requestId, { forUpdate: true, client });
    if (!request) throw httpError(404, "Radio request not found.");
    if (request.driverId !== driverId) throw httpError(403, "Forbidden.");
    if (request.status !== "pending") throw httpError(409, "Request is no longer pending.");
    const updated = await RadioModel.updateRequest(requestId, {
      status: "canceled",
      handled_at: new Date(),
    }, client);
    await client.query("COMMIT");
    emitRequest(updated);
    return { request: updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createSession({ operatorId, driverId, rideId, requestId, client }) {
  await validateDriverReachable(driverId);
  try {
    const session = await RadioModel.createSession({
      operatorId, driverId, rideId, requestId,
    }, client);
    await RadioModel.insertEvent({
      sessionId: session.id,
      actorId: operatorId,
      actorRole: "operator",
      eventType: "session_created",
    }, client);
    return session;
  } catch (error) {
    if (error?.code === "23505") {
      throw httpError(409, "Operator or driver already has an active radio session.");
    }
    throw error;
  }
}

async function createDirectSession(operatorId, { driverId, rideId }) {
  const session = await createSession({ operatorId, driverId, rideId });
  emitSession(session, "radio:incoming");
  return { session };
}

async function acceptRequest(requestId, operatorId) {
  const client = await RadioModel.pool.connect();
  try {
    await client.query("BEGIN");
    const request = await RadioModel.getRequest(requestId, { forUpdate: true, client });
    if (!request) throw httpError(404, "Radio request not found.");
    if (request.status !== "pending") throw httpError(409, "Request is no longer pending.");
    if (new Date(request.expiresAt).getTime() <= Date.now()) {
      throw httpError(409, "Request has expired.");
    }
    const session = await createSession({
      requestId,
      operatorId,
      driverId: request.driverId,
      rideId: request.rideId,
      client,
    });
    const updated = await RadioModel.updateRequest(requestId, {
      status: "accepted",
      handled_by_operator_id: operatorId,
      handled_at: new Date(),
    }, client);
    await client.query("COMMIT");
    emitRequest(updated);
    emitSession(session, "radio:incoming");
    return { request: updated, session };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectRequest(requestId, operatorId, reason) {
  const client = await RadioModel.pool.connect();
  try {
    await client.query("BEGIN");
    const request = await RadioModel.getRequest(requestId, { forUpdate: true, client });
    if (!request) throw httpError(404, "Radio request not found.");
    if (request.status !== "pending") throw httpError(409, "Request is no longer pending.");
    const updated = await RadioModel.updateRequest(requestId, {
      status: "rejected",
      handled_by_operator_id: operatorId,
      handled_at: new Date(),
      resolution_reason: reason || "operator_rejected",
    }, client);
    await client.query("COMMIT");
    emitRequest(updated);
    return { request: updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getSessionForParticipant(sessionId, user) {
  const session = await RadioModel.getSession(sessionId);
  if (!session) throw httpError(404, "Radio session not found.");
  if (
    user.role !== "admin" &&
    session.operatorId !== user.id &&
    session.driverId !== user.id
  ) throw httpError(403, "Forbidden.");
  return session;
}

async function transitionSession(sessionId, user, action, payload = {}) {
  const session = await getSessionForParticipant(sessionId, user);
  if (TERMINAL_SESSION_STATUSES.has(session.status)) throw httpError(409, "Session ended.");
  const fields = { last_activity_at: new Date() };
  let eventType = action;

  if (action === "connected") {
    fields.status = "idle"; fields.connected_at = new Date(); fields.speaker = null;
  } else if (action === "talk_start") {
    if (user.role !== "operator" || !["idle", "operator_speaking"].includes(session.status))
      throw httpError(409, "Operator cannot speak in the current state.");
    fields.status = "operator_speaking"; fields.speaker = "operator";
  } else if (action === "talk_stop") {
    if (user.role !== "operator" || session.status !== "operator_speaking")
      throw httpError(409, "Operator is not speaking.");
    fields.status = "idle"; fields.speaker = null;
  } else if (action === "reply_start") {
    if (user.role !== "driver" || session.status !== "idle")
      throw httpError(409, "Driver cannot reply in the current state.");
    fields.status = "driver_replying"; fields.speaker = "driver";
  } else if (action === "reply_stop") {
    if (user.role !== "driver" || session.status !== "driver_replying")
      throw httpError(409, "Driver is not replying.");
    fields.status = "idle"; fields.speaker = null;
  } else if (action === "mute") {
    fields[user.role === "driver" ? "driver_muted" : "operator_muted"] = Boolean(payload.muted);
  } else if (action === "end") {
    fields.status = "ended"; fields.ended_at = new Date();
    fields.end_reason = payload.reason || "participant_ended"; fields.speaker = null;
  } else {
    throw httpError(400, "Unknown radio action.");
  }

  const updated = await RadioModel.updateSession(sessionId, fields);
  await RadioModel.insertEvent({
    sessionId, actorId: user.id, actorRole: user.role, eventType,
    metadata: action === "mute" ? { muted: Boolean(payload.muted) } : {},
  });
  emitSession(updated, updated.status === "ended" ? "radio:ended" : "radio:state-changed");
  return updated;
}

async function sweep() {
  const expiredRequests = await RadioModel.expireRequests();
  expiredRequests.forEach((request) => emitRequest(request));
  const expiredSessions = await RadioModel.expireSessions({
    connectSeconds: env.radio.connectTimeoutSeconds,
    idleSeconds: env.radio.idleTimeoutSeconds,
  });
  expiredSessions.forEach((session) => emitSession(session, "radio:ended"));
  return { expiredRequests, expiredSessions };
}

module.exports = {
  createDriverRequest,
  getMyRequest,
  cancelRequest,
  listRequests: RadioModel.listRequests,
  acceptRequest,
  rejectRequest,
  createDirectSession,
  getSessionForParticipant,
  transitionSession,
  sweep,
  __private: { validateDriverReachable },
};
