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

  const actionEvents = {
    "radio:connected": "connected",
    "radio:talk-start": "talk_start",
    "radio:talk-stop": "talk_stop",
    "radio:reply-start": "reply_start",
    "radio:reply-stop": "reply_stop",
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
