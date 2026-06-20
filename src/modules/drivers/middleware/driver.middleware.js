function toWktPoint(location) {
  if (!location) {
    return null;
  }

  const { lat, latitude, lng, lon, longitude } = location;
  const latValue = typeof latitude === "number" ? latitude : lat;
  const lngValue =
    typeof longitude === "number"
      ? longitude
      : typeof lng === "number"
      ? lng
      : lon;

  if (
    typeof latValue !== "number" ||
    typeof lngValue !== "number" ||
    Number.isNaN(latValue) ||
    Number.isNaN(lngValue) ||
    latValue < -90 ||
    latValue > 90 ||
    lngValue < -180 ||
    lngValue > 180
  ) {
    return null;
  }

  return `SRID=4326;POINT(${lngValue} ${latValue})`;
}

function updateLocation(req, res, next) {
  const { currentLocation, heading, speedKmh } = req.body || {};

  const wkt = currentLocation ? toWktPoint(currentLocation) : null;
  if (currentLocation && !wkt) {
    return res.status(400).json({
      message: "currentLocation must contain valid lat/lng coordinates.",
    });
  }

  if (!currentLocation && (heading !== undefined || speedKmh !== undefined)) {
    return res.status(400).json({
      message: "heading and speedKmh require currentLocation.",
    });
  }

  if (
    heading !== undefined &&
    (Number.isNaN(Number(heading)) || Number(heading) < 0 || Number(heading) >= 360)
  ) {
    return res.status(400).json({
      message: "heading must be a number between 0 inclusive and 360 exclusive.",
    });
  }

  if (
    speedKmh !== undefined &&
    (Number.isNaN(Number(speedKmh)) || Number(speedKmh) < 0)
  ) {
    return res.status(400).json({
      message: "speedKmh must be a non-negative number.",
    });
  }

  req.body.currentLocationWkt = wkt;
  req.body.hasLocation = Boolean(currentLocation);
  next();
}

function updateStatus(req, res, next) {
  const { status } = req.body || {};

  if (!status) {
    return res.status(400).json({
      message: "status is required.",
    });
  }

  const allowedStatuses = ["offline", "online", "busy", "unavailable"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      message: `status must be one of: ${allowedStatuses.join(", ")}`,
    });
  }

  next();
}

function replaceServiceTypes(req, res, next) {
  const { serviceTypes } = req.body || {};

  if (!Array.isArray(serviceTypes) || serviceTypes.length === 0) {
    return res.status(400).json({
      message: "serviceTypes must be a non-empty array.",
    });
  }

  const invalid = serviceTypes.find(
    (code) =>
      typeof code !== "string" ||
      !/^[a-z][a-z0-9_-]{1,49}$/.test(code.trim())
  );

  if (invalid) {
    return res.status(400).json({
      message:
        "Each service type code must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens.",
    });
  }

  req.body.serviceTypes = serviceTypes.map((code) => code.trim());
  next();
}

function listHotZoneRequests(req, res, next) {
  const zoneId = String(req.params.zoneId || "");
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(zoneId)) {
    return res.status(400).json({ message: "zoneId must be a valid UUID." });
  }

  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(page) || page < 1) {
    return res.status(400).json({ message: "page must be a positive integer." });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return res.status(400).json({ message: "limit must be an integer between 1 and 50." });
  }

  req.query.page = page;
  req.query.limit = limit;
  next();
}

module.exports = {
  updateLocation,
  updateStatus,
  replaceServiceTypes,
  listHotZoneRequests,
};
