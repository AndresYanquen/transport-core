const { env } = require("../../../config");
const { getRedisCommandClient, getRedisUrl } = require("../../../config/redis");
const { logger } = require("../../../config/logger");

const ONLINE_DRIVERS_KEY = "drivers:online";

function presenceKey(driverId) {
  return `driver:presence:${driverId}`;
}

function isPresenceCacheEnabled() {
  return Boolean(env.driverPresence.cacheEnabled && getRedisUrl());
}

function buildPresenceSnapshot(driver) {
  if (!driver?.userId) {
    return null;
  }

  return {
    driverId: driver.userId,
    status: driver.status,
    availabilityIntent: driver.availabilityIntent,
    lastSeenAt: driver.lastSeenAt,
    offlineReason: driver.offlineReason,
    updatedAt: driver.updatedAt || new Date().toISOString(),
    currentLocation: driver.currentLocation ?? null,
    headingDegrees: driver.headingDegrees ?? null,
    speedKmh: driver.speedKmh ?? null,
    serviceTypes: driver.serviceTypes || [],
  };
}

async function writeRecentPresence(driver) {
  if (!isPresenceCacheEnabled() || !driver?.userId) {
    return;
  }

  const client = await getRedisCommandClient();
  const key = presenceKey(driver.userId);
  const ttlSeconds = Math.max(5, env.driverPresence.staleAfterSeconds);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (driver.status !== "online") {
    await Promise.all([
      client.sendCommand(["DEL", key]),
      client.sendCommand(["ZREM", ONLINE_DRIVERS_KEY, String(driver.userId)]),
    ]);
    return;
  }

  const snapshot = buildPresenceSnapshot(driver);
  await Promise.all([
    client.sendCommand(["SET", key, JSON.stringify(snapshot), "EX", String(ttlSeconds)]),
    client.sendCommand(["ZADD", ONLINE_DRIVERS_KEY, String(nowSeconds), String(driver.userId)]),
    client.sendCommand([
      "ZREMRANGEBYSCORE",
      ONLINE_DRIVERS_KEY,
      "-inf",
      String(nowSeconds - ttlSeconds),
    ]),
  ]);
}

async function removeRecentPresence(driverId) {
  if (!isPresenceCacheEnabled() || !driverId) {
    return;
  }

  const client = await getRedisCommandClient();
  await Promise.all([
    client.sendCommand(["DEL", presenceKey(driverId)]),
    client.sendCommand(["ZREM", ONLINE_DRIVERS_KEY, String(driverId)]),
  ]);
}

function writeRecentPresenceBestEffort(driver) {
  if (!isPresenceCacheEnabled()) {
    return;
  }

  writeRecentPresence(driver).catch((error) => {
    logger.warn("driver_presence_cache_write_failed", {
      driverId: driver?.userId,
      error,
    });
  });
}

function removeRecentPresenceBestEffort(driverId) {
  if (!isPresenceCacheEnabled()) {
    return;
  }

  removeRecentPresence(driverId).catch((error) => {
    logger.warn("driver_presence_cache_remove_failed", {
      driverId,
      error,
    });
  });
}

module.exports = {
  ONLINE_DRIVERS_KEY,
  presenceKey,
  buildPresenceSnapshot,
  isPresenceCacheEnabled,
  writeRecentPresence,
  removeRecentPresence,
  writeRecentPresenceBestEffort,
  removeRecentPresenceBestEffort,
};
