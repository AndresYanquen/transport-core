function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function parseCoordinate(value, { min, max }) {
  if (isBlank(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function autocomplete(req, res, next) {
  const { query, lat, lng, sessionToken } = req.query || {};

  if (isBlank(query)) {
    return res.status(400).json({ message: "query is required." });
  }

  if (isBlank(sessionToken)) {
    return res.status(400).json({ message: "sessionToken is required." });
  }

  const normalized = {
    query: String(query).trim(),
    sessionToken: String(sessionToken).trim(),
  };

  if (!isBlank(lat) || !isBlank(lng)) {
    const parsedLat = parseCoordinate(lat, { min: -90, max: 90 });
    const parsedLng = parseCoordinate(lng, { min: -180, max: 180 });

    if (parsedLat === null || parsedLng === null) {
      return res.status(400).json({
        message: "lat and lng must both be valid coordinates when provided.",
      });
    }

    normalized.lat = parsedLat;
    normalized.lng = parsedLng;
  }

  req.placesQuery = normalized;
  next();
}

function details(req, res, next) {
  const { placeId, sessionToken } = req.query || {};

  if (isBlank(placeId)) {
    return res.status(400).json({ message: "placeId is required." });
  }

  if (isBlank(sessionToken)) {
    return res.status(400).json({ message: "sessionToken is required." });
  }

  req.placesQuery = {
    placeId: String(placeId).trim(),
    sessionToken: String(sessionToken).trim(),
  };
  next();
}

function geocode(req, res, next) {
  const { query } = req.query || {};

  if (isBlank(query)) {
    return res.status(400).json({ message: "query is required." });
  }

  req.placesQuery = {
    query: String(query).trim(),
  };
  next();
}

function reverseGeocode(req, res, next) {
  const { lat, lng } = req.query || {};
  const parsedLat = parseCoordinate(lat, { min: -90, max: 90 });
  const parsedLng = parseCoordinate(lng, { min: -180, max: 180 });

  if (parsedLat === null) {
    return res.status(400).json({ message: "lat is required and must be valid." });
  }

  if (parsedLng === null) {
    return res.status(400).json({ message: "lng is required and must be valid." });
  }

  req.placesQuery = {
    lat: parsedLat,
    lng: parsedLng,
  };
  next();
}

module.exports = {
  autocomplete,
  details,
  geocode,
  reverseGeocode,
  __private: {
    parseCoordinate,
  },
};
