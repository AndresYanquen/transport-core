const axios = require("axios");
const { env } = require("../../../config");

const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const GOOGLE_PLACES_DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json";
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const GOOGLE_SUCCESS_STATUSES = new Set(["OK", "ZERO_RESULTS"]);

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getGoogleMapsApiKey() {
  if (!env.google.mapsApiKey) {
    throw createHttpError(500, "Google Maps API key is not configured.");
  }

  return env.google.mapsApiKey;
}

function getTextFromAddress(address = "") {
  const [firstPart] = String(address).split(",");
  return firstPart.trim() || String(address).trim();
}

function normalizeAutocompletePrediction(prediction) {
  const placeName = prediction.description || "";

  return {
    id: prediction.place_id,
    text:
      prediction.structured_formatting?.main_text ||
      prediction.terms?.[0]?.value ||
      getTextFromAddress(placeName),
    placeName,
    center: [0, 0],
  };
}

function normalizePlaceResult(result, fallbackId) {
  const location = result.geometry?.location || {};
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const placeName = result.formatted_address || result.name || "";

  return {
    id: result.place_id || fallbackId,
    text: result.name || getTextFromAddress(placeName),
    placeName,
    center: [Number.isFinite(lng) ? lng : 0, Number.isFinite(lat) ? lat : 0],
  };
}

function normalizeGeocodeResult(result, fallbackLocation) {
  const location = result.geometry?.location || {};
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const placeName = result.formatted_address || "";

  return {
    id: result.place_id || "reverse-geocode-id",
    text: getTextFromAddress(placeName),
    placeName,
    center: [
      Number.isFinite(lng) ? lng : fallbackLocation.lng,
      Number.isFinite(lat) ? lat : fallbackLocation.lat,
    ],
  };
}

function assertGoogleStatus(responseData) {
  const status = responseData?.status;

  if (GOOGLE_SUCCESS_STATUSES.has(status)) {
    return;
  }

  if (status === "INVALID_REQUEST") {
    throw createHttpError(400, "Google request was invalid.");
  }

  if (status === "REQUEST_DENIED") {
    throw createHttpError(502, "Google request was denied.");
  }

  throw createHttpError(502, "Google Places service is unavailable.");
}

async function googleGet(httpClient, url, options) {
  try {
    return await httpClient.get(url, options);
  } catch (_error) {
    throw createHttpError(502, "Google Places service is unavailable.");
  }
}

async function autocomplete({ query, lat, lng, sessionToken }, { httpClient = axios } = {}) {
  const params = {
    input: query,
    sessiontoken: sessionToken,
    key: getGoogleMapsApiKey(),
  };

  if (lat !== undefined && lng !== undefined) {
    params.location = `${lat},${lng}`;
    params.radius = 50000;
  }

  const { data } = await googleGet(httpClient, GOOGLE_PLACES_AUTOCOMPLETE_URL, {
    params,
  });
  assertGoogleStatus(data);

  return {
    features: (data.predictions || []).map(normalizeAutocompletePrediction),
  };
}

async function details({ placeId, sessionToken }, { httpClient = axios } = {}) {
  const { data } = await googleGet(httpClient, GOOGLE_PLACES_DETAILS_URL, {
    params: {
      place_id: placeId,
      sessiontoken: sessionToken,
      fields: "place_id,name,formatted_address,geometry",
      key: getGoogleMapsApiKey(),
    },
  });
  assertGoogleStatus(data);

  if (!data.result) {
    throw createHttpError(404, "Place not found.");
  }

  return {
    feature: normalizePlaceResult(data.result, placeId),
  };
}

async function reverseGeocode({ lat, lng }, { httpClient = axios } = {}) {
  const { data } = await googleGet(httpClient, GOOGLE_GEOCODE_URL, {
    params: {
      latlng: `${lat},${lng}`,
      key: getGoogleMapsApiKey(),
    },
  });
  assertGoogleStatus(data);

  const [firstResult] = data.results || [];
  if (!firstResult) {
    throw createHttpError(404, "Address not found.");
  }

  return {
    feature: normalizeGeocodeResult(firstResult, { lat, lng }),
  };
}

module.exports = {
  autocomplete,
  details,
  reverseGeocode,
  __private: {
    GOOGLE_PLACES_AUTOCOMPLETE_URL,
    GOOGLE_PLACES_DETAILS_URL,
    GOOGLE_GEOCODE_URL,
    normalizeAutocompletePrediction,
    normalizePlaceResult,
    normalizeGeocodeResult,
    assertGoogleStatus,
    googleGet,
  },
};
