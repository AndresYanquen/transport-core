const crypto = require("crypto");

const { env } = require("../config");
const { logger } = require("../config/logger");

function requestLogger(req, res, next) {
  if (!env.http.requestLogsEnabled) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  const suppliedId = req.headers["x-request-id"];
  const requestId = typeof suppliedId === "string" && /^[0-9a-f-]{36}$/i.test(suppliedId)
    ? suppliedId : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info("http_request", {
      requestId,
      method: req.method,
      // OTPs and identity tokens supplied in a query string must never reach logs.
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: req.ip,
    });
  });

  next();
}

module.exports = {
  requestLogger,
};
