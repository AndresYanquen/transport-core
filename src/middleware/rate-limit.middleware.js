const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");

const { env } = require("../config");
const { getRedisCommandClient, getRedisUrl } = require("../config/redis");
const { logger } = require("../config/logger");

function buildRedisRateLimitStore(prefix) {
  if (!getRedisUrl()) {
    logger.info("rate_limit_memory_store_enabled", { prefix });
    return undefined;
  }

  logger.info("rate_limit_redis_store_enabled", { prefix });
  return new RedisStore({
    prefix,
    sendCommand: async (...args) => {
      const client = await getRedisCommandClient();
      return client.sendCommand(args);
    },
  });
}

function createAuthRateLimiter() {
  return rateLimit({
    windowMs: env.http.authRateLimitWindowMs,
    limit: env.http.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: buildRedisRateLimitStore("rl:auth:"),
    message: {
      message: "Too many authentication attempts. Please try again later.",
    },
  });
}

module.exports = {
  createAuthRateLimiter,
  buildRedisRateLimitStore,
};
