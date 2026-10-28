const Presence = require("../services/push-presence.service");

function registerPushSocketHandlers(socket) {
  // Public tracking connections never reach this handler. Identity comes only from socket authentication.
  if (socket.data.auth?.role !== "driver" || !socket.data.auth.payload?.sid) return;
  const limits = new Map();
  function register(event, limit, action) {
    socket.on(event, async (body, ack) => {
      if (typeof ack !== "function") return; // Clients must await the operation result.
      const now = Date.now();
      let bucket = limits.get(event);
      if (!bucket || now >= bucket.until) {
        bucket = { count: 0, until: now + 60000 };
        limits.set(event, bucket);
      }
      if (++bucket.count > limit) return ack({ ok: false, status: 429, message: "Too many push requests. Try again later." });
      try {
        const result = await action(socket.data.auth, body);
        ack({ ok: true, ...result });
      } catch (error) {
        ack({ ok: false, status: error.status || 503,
          message: error.status ? error.message : "Push operation unavailable." });
      }
    });
  }
  register("push:presence", 60, Presence.reportVisibility);
  register("ride:invite-presented", 120, Presence.acknowledgePresentation);
}
module.exports = { registerPushSocketHandlers };
