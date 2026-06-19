const allowedTypes = ["operational", "hot_zone", "restricted", "pricing_zone"];
const allowedStatuses = ["active", "inactive"];

function isLngLatPair(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(Number(point[0])) &&
    Number.isFinite(Number(point[1])) &&
    Number(point[0]) >= -180 &&
    Number(point[0]) <= 180 &&
    Number(point[1]) >= -90 &&
    Number(point[1]) <= 90
  );
}

function normalizeCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    return null;
  }

  const points = coordinates.map((point) => [Number(point[0]), Number(point[1])]);
  if (!points.every(isLngLatPair)) return null;

  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    points.push([...first]);
  }

  if (points.length < 4) return null;
  return points;
}

function validateColor(color) {
  return color === undefined || color === null || /^#[0-9A-Fa-f]{6}$/.test(String(color));
}

function validateCreateZone(req, res, next) {
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = body.type || "operational";
  const status = body.status || "active";
  const coordinates = normalizeCoordinates(body.coordinates);

  if (!name) {
    return res.status(400).json({ message: "name is required." });
  }

  if (!allowedTypes.includes(type)) {
    return res.status(400).json({
      message: `type must be one of: ${allowedTypes.join(", ")}.`,
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      message: `status must be one of: ${allowedStatuses.join(", ")}.`,
    });
  }

  if (!validateColor(body.color)) {
    return res.status(400).json({ message: "color must be a hex color like #2563EB." });
  }

  if (!coordinates) {
    return res.status(400).json({
      message: "coordinates must contain at least 3 lng/lat points.",
    });
  }

  req.adminZonePayload = {
    name,
    type,
    status,
    color: body.color || null,
    coordinates,
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
  };

  next();
}

function validateZoneId(req, res, next) {
  const id = String(req.params.zoneId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ message: "zoneId must be a valid UUID." });
  }
  req.adminZoneId = id;
  next();
}

module.exports = {
  validateCreateZone,
  validateZoneId,
};
