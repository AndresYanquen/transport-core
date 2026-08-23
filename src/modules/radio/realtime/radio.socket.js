const RadioService = require("../services/radio.service");

const SIGNAL_LIMIT = 64 * 1024;

function validSignal(payload) {
  try {
    return JSON.stringify(payload || {}).length <= SIGNAL_LIMIT;
  } catch (_error) {
    return false;
  }
}

function registerRadioSocketHandlers(io, socket, { userRoom }) {
  const user = socket.data.user;
  const heldTalkLocks = new Set();

  async function withSession(payload, handler) {
    try {
      if (!payload?.sessionId) throw Object.assign(new Error("sessionId is required."), { status: 400 });
      const session = await RadioService.getSessionForParticipant(payload.sessionId, user);
      await handler(session);
    } catch (error) {
      socket.emit("radio:error", {
        sessionId: payload?.sessionId || null,
        message: error.message,
        status: error.status || 500,
      });
    }
  }

  for (const [incoming, outgoing] of [
    ["radio:offer", "radio:offer"],
    ["radio:answer", "radio:answer"],
    ["radio:ice-candidate", "radio:ice-candidate"],
  ]) {
    socket.on(incoming, (payload = {}) => withSession(payload, async (session) => {
      if (!validSignal(payload.signal || payload.candidate)) {
        throw Object.assign(new Error("Signaling payload is too large or invalid."), { status: 400 });
      }
      if (incoming === "radio:offer" && user.role !== "operator") {
        throw Object.assign(new Error("Only operators may send offers."), { status: 403 });
      }
      if (incoming === "radio:answer" && user.role !== "driver") {
        throw Object.assign(new Error("Only drivers may send answers."), { status: 403 });
      }
      const targetId = user.id === session.operatorId ? session.driverId : session.operatorId;
      io.to(userRoom(targetId)).emit(outgoing, {
        sessionId: session.id,
        signal: payload.signal,
        candidate: payload.candidate,
        emittedAt: new Date().toISOString(),
      });
    }));
  }

  async function emitTalkResult(payload, executor) {
    try {
      if (!payload?.sessionId) throw Object.assign(new Error("sessionId is required."), { status: 400 });
      const result = await executor(payload.sessionId);
      return result;
    } catch (error) {
      socket.emit("radio:error", {
        sessionId: payload?.sessionId || null,
        message: error.message,
        status: error.status || 500,
      });
      return null;
    }
  }

  async function handleTalkStart(payload = {}) {
    const result = await emitTalkResult(payload, (sessionId) => RadioService.acquireTalkLock(sessionId, user));
    if (!result) return;

    if (result.granted) {
      heldTalkLocks.add(result.session.id);
      socket.emit("radio:talk:granted", {
        sessionId: result.session.id,
        talk: result.talk,
        ttlSeconds: result.ttlSeconds,
        emittedAt: new Date().toISOString(),
      });
      return;
    }

    socket.emit("radio:talk:denied", {
      sessionId: result.session.id,
      reason: result.reason,
      talkingBy: result.talk?.userId || null,
      talkingRole: result.talk?.role || null,
      emittedAt: new Date().toISOString(),
    });
  }

  async function handleTalkHeartbeat(payload = {}) {
    const result = await emitTalkResult(payload, (sessionId) => RadioService.heartbeatTalkLock(sessionId, user));
    if (!result) return;

    socket.emit("radio:talk:heartbeat", {
      sessionId: result.session.id,
      renewed: result.renewed,
      reason: result.reason || null,
      ttlSeconds: result.ttlSeconds || null,
      emittedAt: new Date().toISOString(),
    });
  }

  async function handleTalkStop(payload = {}) {
    const result = await emitTalkResult(payload, (sessionId) => RadioService.releaseTalkLock(sessionId, user));
    if (!result) return;

    heldTalkLocks.delete(result.session.id);
    socket.emit("radio:talk:stopped", {
      sessionId: result.session.id,
      released: result.released,
      reason: result.reason || null,
      emittedAt: new Date().toISOString(),
    });
  }

  socket.on("radio:talk:start", handleTalkStart);
  socket.on("radio:talk:heartbeat", handleTalkHeartbeat);
  socket.on("radio:talk:stop", handleTalkStop);
  socket.on("radio:talk-start", handleTalkStart);
  socket.on("radio:reply-start", handleTalkStart);
  socket.on("radio:talk-stop", handleTalkStop);
  socket.on("radio:reply-stop", handleTalkStop);

  socket.on("disconnect", () => {
    for (const sessionId of heldTalkLocks) {
      RadioService.releaseTalkLock(sessionId, user).catch(() => {});
    }
    heldTalkLocks.clear();
  });

  const actionEvents = {
    "radio:connected": "connected",
    "radio:mute": "mute",
    "radio:end": "end",
  };
  for (const [eventName, action] of Object.entries(actionEvents)) {
    socket.on(eventName, (payload = {}) => withSession(payload, async () => {
      await RadioService.transitionSession(payload.sessionId, user, action, payload);
    }));
  }
}

module.exports = { registerRadioSocketHandlers };
