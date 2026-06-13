const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractLocation(body) {
  const location = body.location || {};
  const lat = hasOwn(body, "lat") ? body.lat : location.lat ?? location.latitude;
  const lng = hasOwn(body, "lng")
    ? body.lng
    : location.lng ?? location.lon ?? location.longitude;

  return {
    lat: parseCoordinate(lat),
    lng: parseCoordinate(lng),
  };
}

function validateLocation(location) {
  return (
    location.lat !== null &&
    location.lng !== null &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180
  );
}

function validateDestinationId(req, res, next) {
  const { id } = req.params;

  if (!UUID_PATTERN.test(String(id))) {
    return res.status(400).json({ message: "Saved destination id must be a UUID." });
  }

  req.savedDestinationId = id;
  next();
}

function validateListQuery(req, res, next) {
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ message: "limit must be an integer from 1 to 100." });
  }

  const queryText =
    typeof req.query.q === "string" && req.query.q.trim()
      ? req.query.q.trim()
      : null;

  req.savedDestinationQuery = {
    limit,
    queryText,
  };
  next();
}

function validateCreateDestination(req, res, next) {
  const body = req.body || {};

  if (!isNonBlankString(body.label)) {
    return res.status(400).json({ message: "label is required." });
  }

  if (!isNonBlankString(body.placeName)) {
    return res.status(400).json({ message: "placeName is required." });
  }

  if (
    hasOwn(body, "formattedAddress") &&
    body.formattedAddress !== null &&
    typeof body.formattedAddress !== "string"
  ) {
    return res.status(400).json({
      message: "formattedAddress must be a string or null when provided.",
    });
  }

  if (
    hasOwn(body, "placeId") &&
    body.placeId !== null &&
    typeof body.placeId !== "string"
  ) {
    return res.status(400).json({ message: "placeId must be a string or null." });
  }

  const location = extractLocation(body);
  if (!validateLocation(location)) {
    return res.status(400).json({
      message: "location must include valid lat/lng values.",
    });
  }

  req.savedDestinationPayload = {
    label: body.label.trim(),
    placeName: body.placeName.trim(),
    formattedAddress: hasOwn(body, "formattedAddress")
      ? body.formattedAddress?.trim() || null
      : null,
    placeId: hasOwn(body, "placeId") ? body.placeId?.trim() || null : null,
    lat: location.lat,
    lng: location.lng,
  };
  next();
}

function validateUpdateDestination(req, res, next) {
  const body = req.body || {};
  const payload = {};

  if (hasOwn(body, "label")) {
    if (!isNonBlankString(body.label)) {
      return res.status(400).json({ message: "label must be a non-empty string." });
    }
    payload.label = body.label.trim();
  }

  if (hasOwn(body, "placeName")) {
    if (!isNonBlankString(body.placeName)) {
      return res.status(400).json({
        message: "placeName must be a non-empty string.",
      });
    }
    payload.placeName = body.placeName.trim();
  }

  if (hasOwn(body, "formattedAddress")) {
    if (body.formattedAddress !== null && typeof body.formattedAddress !== "string") {
      return res.status(400).json({
        message: "formattedAddress must be a string or null.",
      });
    }
    payload.hasFormattedAddress = true;
    payload.formattedAddress = body.formattedAddress?.trim() || null;
  }

  if (hasOwn(body, "placeId")) {
    if (body.placeId !== null && typeof body.placeId !== "string") {
      return res.status(400).json({ message: "placeId must be a string or null." });
    }
    payload.hasPlaceId = true;
    payload.placeId = body.placeId?.trim() || null;
  }

  const hasLocation =
    hasOwn(body, "location") ||
    hasOwn(body, "lat") ||
    hasOwn(body, "lng");

  if (hasLocation) {
    const location = extractLocation(body);
    if (!validateLocation(location)) {
      return res.status(400).json({
        message: "location must include valid lat/lng values.",
      });
    }

    payload.hasLocation = true;
    payload.lat = location.lat;
    payload.lng = location.lng;
  }

  if (!Object.keys(payload).length) {
    return res.status(400).json({
      message:
        "At least one of label, placeName, formattedAddress, placeId, or location is required.",
    });
  }

  payload.hasFormattedAddress = Boolean(payload.hasFormattedAddress);
  payload.hasPlaceId = Boolean(payload.hasPlaceId);
  payload.hasLocation = Boolean(payload.hasLocation);

  req.savedDestinationPayload = payload;
  next();
}

module.exports = {
  validateDestinationId,
  validateListQuery,
  validateCreateDestination,
  validateUpdateDestination,
  __private: {
    UUID_PATTERN,
    extractLocation,
    validateLocation,
  },
};
