const { createClient } = require("redis");

const { env } = require("./env");
const { logger } = require("./logger");

let pubClient = null;
let subClient = null;
let commandClient = null;

function getRedisUrl() {
  return env.redis.url;
}

async function initializeRedisClients() {
  if (!getRedisUrl()) {
    return null;
  }

  if (pubClient && subClient) {
    return { pubClient, subClient };
  }

  pubClient = createClient({
    url: getRedisUrl(),
    socket: {
      connectTimeout: env.redis.connectTimeoutMs,
      reconnectStrategy: (retries) => {
        const delay = Math.min(retries * 100, env.redis.maxReconnectDelayMs);
        logger.warn("redis_reconnect_scheduled", { retries, delay });
        return delay;
      },
    },
  });
  subClient = pubClient.duplicate();

  pubClient.on("error", (error) => logger.error("redis_pub_error", { error }));
  subClient.on("error", (error) => logger.error("redis_sub_error", { error }));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  logger.info("redis_connected");

  return { pubClient, subClient };
}

async function getRedisCommandClient() {
  if (!getRedisUrl()) {
    return null;
  }

  if (commandClient) {
    return commandClient;
  }

  commandClient = createClient({
    url: getRedisUrl(),
    socket: {
      connectTimeout: env.redis.connectTimeoutMs,
      reconnectStrategy: (retries) => {
        const delay = Math.min(retries * 100, env.redis.maxReconnectDelayMs);
        logger.warn("redis_command_reconnect_scheduled", { retries, delay });
        return delay;
      },
    },
  });

  commandClient.on("error", (error) => logger.error("redis_command_error", { error }));
  await commandClient.connect();
  logger.info("redis_command_connected");

  return commandClient;
}

async function closeRedisClients() {
  const clients = [subClient, pubClient, commandClient].filter(Boolean);
  subClient = null;
  pubClient = null;
  commandClient = null;

  await Promise.all(
    clients.map(async (client) => {
      if (!client.isOpen) {
        return;
      }
      await client.quit();
    })
  );
}

module.exports = {
  initializeRedisClients,
  getRedisCommandClient,
  closeRedisClients,
  getRedisUrl,
};
