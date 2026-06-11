const SettingsModel = require("../models/settings.model");

const DEFAULT_CACHE_TTL_MS = 30_000;
const cache = new Map();

function getCachedSetting(key) {
  const cached = cache.get(key);

  if (!cached) {
    return { hit: false };
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return { hit: false };
  }

  return {
    hit: true,
    setting: cached.setting,
  };
}

function setCachedSetting(key, setting, ttlMs) {
  cache.set(key, {
    setting,
    expiresAt: Date.now() + ttlMs,
  });
}

async function getSetting(key, { ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  const cached = getCachedSetting(key);

  if (cached.hit) {
    return cached.setting;
  }

  const setting = await SettingsModel.findByKey(key);
  setCachedSetting(key, setting, ttlMs);

  return setting;
}

async function getNumberSetting(
  key,
  fallback,
  { ttlMs = DEFAULT_CACHE_TTL_MS, positiveOnly = true } = {}
) {
  const setting = await getSetting(key, { ttlMs });
  const value = Number(setting?.value);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  if (positiveOnly && value <= 0) {
    return fallback;
  }

  return value;
}

async function getSettings(keys, { ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await getSetting(key, { ttlMs })])
  );

  return Object.fromEntries(entries);
}

function clearCache(key) {
  if (key) {
    cache.delete(key);
    return;
  }

  cache.clear();
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  getSetting,
  getSettings,
  getNumberSetting,
  clearCache,
};
