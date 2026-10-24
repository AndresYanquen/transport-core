const { EventEmitter } = require("node:events");
const { logger } = require("../../../config/logger");

const events = new EventEmitter();

function notifyRevoked(ids) {
  if (!ids?.length) return;
  try { events.emit("revoked", ids); }
  catch { logger.error("mobile_session_disconnect_failed"); }
}

module.exports = { events, notifyRevoked };
