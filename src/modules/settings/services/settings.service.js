const SettingsModel = require("../models/settings.model");
const { operationalSettingKeys } = require("../settings.definitions");

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

async function getSettingValue(key, fallback = "", { ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  const setting = await getSetting(key, { ttlMs });
  return setting?.value ?? fallback;
}

async function getSettings(keys, { ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await getSetting(key, { ttlMs })])
  );

  return Object.fromEntries(entries);
}

async function getOperationalSettings({ ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  const settings = await getSettings(operationalSettingKeys, { ttlMs });

  const value = (key, fallback = "") => settings[key]?.value ?? fallback;
  const numberValue = (key, fallback) => {
    const parsed = Number(value(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    cityName: value("operational_city_name", "Tunja"),
    regionName: value("operational_region_name", "Boyaca"),
    countryName: value("operational_country_name", "Colombia"),
    countryCode: value("operational_country_code", "CO"),
    timezone: value("operational_timezone", "America/Bogota"),
    defaultLocale: value("operational_default_locale", "es-CO"),
    defaultCurrency: value("operational_default_currency", "COP"),
    defaultPhoneCountry: value("operational_default_phone_country", "CO"),
    map: {
      center: {
        lat: numberValue("operational_map_center_lat", 5.5353),
        lng: numberValue("operational_map_center_lng", -73.3678),
      },
      defaultZoom: numberValue("operational_map_default_zoom", 13),
    },
    places: {
      searchSuffix: value("operational_places_search_suffix", "Tunja, Boyaca, Colombia"),
      countryBias: value("operational_places_country_bias", "co"),
      searchRadiusMeters: numberValue("operational_places_search_radius_meters", 50000),
    },
  };
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
  getOperationalSettings,
  getNumberSetting,
  getSettingValue,
  clearCache,
};
