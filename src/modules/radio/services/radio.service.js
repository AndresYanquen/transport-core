const RadioModel = require("../models/radio.model");
const DriverModel = require("../../drivers/models/driver.model");
const { env } = require("../../../config");
const RedisConfig = require("../../../config/redis");
const { AccessToken } = require("livekit-server-sdk");
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

function emitTalkChanged(session, talk) {
  const payload = {
    sessionId: session.id,
    talking: Boolean(talk),
    talk: talk || null,
    emittedAt: new Date().toISOString(),
  };
  emitToUser(session.operatorId, "radio:talk:changed", payload);
  emitToUser(session.driverId, "radio:talk:changed", payload);
  emitToRole("operator", "operations:radio-talk-changed", payload);
}

function talkLockKey(sessionId) {
  return `radio:talk-lock:${sessionId}`;
}

function talkRoleForUser(user) {
  const role = String(user?.role || "").toLowerCase();
  if (!["operator", "driver"].includes(role)) {
    throw httpError(403, "Only drivers and operators can talk in radio sessions.");
  }
  return role;
}

function talkStateForRole(role) {
  return role === "operator" ? "operator_speaking" : "driver_replying";
}

function serializeTalkLock({ user, role }) {
  return JSON.stringify({
    userId: user.id,
    role,
    startedAt: new Date().toISOString(),
  });
}

function parseTalkLock(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

async function getRedisOrThrow() {
  const client = await RedisConfig.getRedisCommandClient();
  if (!client) {
    throw httpError(503, "Redis is required for radio talk lock.");
  }
  return client;
}

async function readTalkLock(sessionId) {
  const client = await getRedisOrThrow();
  const value = await client.sendCommand(["GET", talkLockKey(sessionId)]);
  return parseTalkLock(value);
}

async function deleteTalkLockIfOwner(sessionId, userId) {
  const client = await getRedisOrThrow();
  const result = await client.sendCommand([
    "EVAL",
    `
      local current = redis.call("GET", KEYS[1])
      if not current then return 0 end
      local decoded = cjson.decode(current)
      if decoded["userId"] ~= ARGV[1] then return -1 end
      redis.call("DEL", KEYS[1])
      return 1
    `,
    "1",
    talkLockKey(sessionId),
    String(userId),
  ]);
  return Number(result);
}

async function renewTalkLockIfOwner(sessionId, userId) {
  const client = await getRedisOrThrow();
  const result = await client.sendCommand([
    "EVAL",
    `
      local current = redis.call("GET", KEYS[1])
      if not current then return 0 end
      local decoded = cjson.decode(current)
      if decoded["userId"] ~= ARGV[1] then return -1 end
      redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
      return 1
    `,
    "1",
    talkLockKey(sessionId),
    String(userId),
    String(env.radio.talkLockTtlSeconds),
  ]);
  return Number(result);
}

function ensureLiveKitConfigured() {
  if (!env.livekit.url || !env.livekit.apiKey || !env.livekit.apiSecret) {
    throw httpError(503, "LiveKit is not configured.");
  }
}

function buildLiveKitIdentity(user) {
  const role = String(user?.role || "user").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `${role}-${user.id}`;
}

function buildRadioRoomName(sessionId) {
  return `radio-${sessionId}`;
}

async function buildLiveKitToken({ user, roomName, canPublish = true, metadata = {} }) {
  ensureLiveKitConfigured();
  if (!user?.id) {
    throw httpError(401, "Authentication is required.");
  }

  const identity = buildLiveKitIdentity(user);
  const token = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
    identity,
    ttl: env.livekit.tokenTtl,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || identity,
    metadata: JSON.stringify({
      userId: user.id,
      role: user.role,
      ...metadata,
    }),
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });

  return {
    url: env.livekit.url,
    room: roomName,
    identity,
    token: await token.toJwt(),
  };
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

async function createLiveKitTokenForSession(sessionId, user) {
  const session = await getSessionForParticipant(sessionId, user);
  if (TERMINAL_SESSION_STATUSES.has(session.status)) {
    throw httpError(409, "Session ended.");
  }

  return {
    session,
    livekit: await buildLiveKitToken({
      user,
      roomName: buildRadioRoomName(session.id),
      canPublish: ["driver", "operator"].includes(String(user.role || "").toLowerCase()),
      metadata: { sessionId: session.id },
    }),
  };
}

async function createLiveKitTestToken(user) {
  const role = String(user?.role || "").toLowerCase();
  if (!["client", "driver", "operator", "admin"].includes(role)) {
    throw httpError(403, "Forbidden.");
  }

  return {
    livekit: await buildLiveKitToken({
      user,
      roomName: env.livekit.testRoom,
      canPublish: true,
    }),
  };
}

async function acquireTalkLock(sessionId, user) {
  const session = await getSessionForParticipant(sessionId, user);
  if (TERMINAL_SESSION_STATUSES.has(session.status)) {
    throw httpError(409, "Session ended.");
  }

  const role = talkRoleForUser(user);
  const client = await getRedisOrThrow();
  const lockValue = serializeTalkLock({ user, role });
  const result = await client.sendCommand([
    "SET",
    talkLockKey(session.id),
    lockValue,
    "NX",
    "EX",
    String(env.radio.talkLockTtlSeconds),
  ]);

  if (result !== "OK") {
    const current = await readTalkLock(session.id);
    return {
      granted: false,
      reason: "busy",
      session,
      talk: current,
    };
  }

  const updated = await RadioModel.updateSession(session.id, {
    status: talkStateForRole(role),
    speaker: role,
    last_activity_at: new Date(),
  });
  await RadioModel.insertEvent({
    sessionId: session.id,
    actorId: user.id,
    actorRole: role,
    eventType: "talk_started",
  });
  emitSession(updated, "radio:state-changed");
  const talk = parseTalkLock(lockValue);
  emitTalkChanged(updated, talk);
  return {
    granted: true,
    session: updated,
    talk,
    ttlSeconds: env.radio.talkLockTtlSeconds,
  };
}

async function heartbeatTalkLock(sessionId, user) {
  const session = await getSessionForParticipant(sessionId, user);
  if (TERMINAL_SESSION_STATUSES.has(session.status)) {
    throw httpError(409, "Session ended.");
  }

  const result = await renewTalkLockIfOwner(session.id, user.id);
  if (result === -1) {
    const current = await readTalkLock(session.id);
    return { renewed: false, reason: "not_owner", session, talk: current };
  }
  if (result === 0) {
    return { renewed: false, reason: "missing", session, talk: null };
  }

  await RadioModel.updateSession(session.id, { last_activity_at: new Date() });
  return {
    renewed: true,
    session,
    ttlSeconds: env.radio.talkLockTtlSeconds,
  };
}

async function releaseTalkLock(sessionId, user, { emit = true } = {}) {
  const session = await getSessionForParticipant(sessionId, user);
  const result = await deleteTalkLockIfOwner(session.id, user.id);

  if (result === -1) {
    const current = await readTalkLock(session.id);
    return { released: false, reason: "not_owner", session, talk: current };
  }
  if (result === 0) {
    return { released: false, reason: "missing", session, talk: null };
  }

  const updated = TERMINAL_SESSION_STATUSES.has(session.status)
    ? session
    : await RadioModel.updateSession(session.id, {
        status: "idle",
        speaker: null,
        last_activity_at: new Date(),
      });
  await RadioModel.insertEvent({
    sessionId: session.id,
    actorId: user.id,
    actorRole: user.role,
    eventType: "talk_stopped",
  });
  if (emit) {
    emitSession(updated, "radio:state-changed");
    emitTalkChanged(updated, null);
  }
  return { released: true, session: updated, talk: null };
}

async function forceReleaseTalkLock(sessionId, { reason = "forced", emit = true } = {}) {
  const session = await RadioModel.getSession(sessionId);
  if (!session) return { released: false, reason: "not_found" };

  const client = await getRedisOrThrow();
  const deleted = Number(await client.sendCommand(["DEL", talkLockKey(session.id)]));
  if (!deleted) return { released: false, reason: "missing", session };

  await RadioModel.insertEvent({
    sessionId: session.id,
    actorId: null,
    actorRole: "system",
    eventType: "talk_stopped",
    metadata: { reason },
  });
  if (emit) {
    emitTalkChanged(session, null);
  }
  return { released: true, session };
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
  if (updated.status === "ended") {
    forceReleaseTalkLock(sessionId, { reason: "session_ended" }).catch(() => {});
  }
  return updated;
}

async function sweep() {
  const expiredRequests = await RadioModel.expireRequests();
  expiredRequests.forEach((request) => emitRequest(request));
  const expiredSessions = await RadioModel.expireSessions({
    connectSeconds: env.radio.connectTimeoutSeconds,
    idleSeconds: env.radio.idleTimeoutSeconds,
  });
  expiredSessions.forEach((session) => {
    forceReleaseTalkLock(session.id, { reason: session.failureReason || session.endReason || "session_expired" }).catch(() => {});
    emitSession(session, "radio:ended");
  });
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
  createLiveKitTokenForSession,
  createLiveKitTestToken,
  acquireTalkLock,
  heartbeatTalkLock,
  releaseTalkLock,
  forceReleaseTalkLock,
  transitionSession,
  sweep,
  __private: {
    validateDriverReachable,
    buildLiveKitIdentity,
    buildRadioRoomName,
    talkLockKey,
  },
};
