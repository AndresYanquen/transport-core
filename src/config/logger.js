const { env } = require("./env");

const levels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function shouldWrite(level) {
  const configuredLevel = String(env.logging.level || "info").toLowerCase();
  const threshold = levels[configuredLevel] ?? levels.info;
  return levels[level] >= threshold;
}

function serializeError(error) {
  if (!error) return undefined;

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function write(level, message, metadata = {}) {
  if (!shouldWrite(level)) {
    return;
  }

  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...metadata,
  };

  if (payload.error instanceof Error) {
    payload.error = serializeError(payload.error);
  }

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

const logger = {
  debug: (message, metadata) => write("debug", message, metadata),
  info: (message, metadata) => write("info", message, metadata),
  warn: (message, metadata) => write("warn", message, metadata),
  error: (message, metadata) => write("error", message, metadata),
};

module.exports = {
  logger,
  serializeError,
  shouldWrite,
};
