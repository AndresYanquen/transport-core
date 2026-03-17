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

  if (!currentLocation) {
    return res.status(400).json({
      message: "currentLocation is required and must contain lat/lng.",
    });
  }

  const wkt = toWktPoint(currentLocation);

  if (!wkt) {
    return res.status(400).json({
      message: "currentLocation must contain valid lat/lng coordinates.",
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

module.exports = {
  updateLocation,
  updateStatus,
};
