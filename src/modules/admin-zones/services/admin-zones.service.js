const { query } = require("../../../config/database");

function coordinatesToWkt(coordinates) {
  const ring = coordinates.map(([lng, lat]) => `${lng} ${lat}`).join(", ");
  return `SRID=4326;POLYGON((${ring}))`;
}

function mapZone(row) {
  const geometry = row.geometry_geojson || null;
  const ring = geometry?.coordinates?.[0] || [];

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    color: row.color,
    coordinates: ring,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listZones() {
  const { rows } = await query(
    `
      SELECT
        id,
        name,
        type,
        status,
        color,
        ST_AsGeoJSON(polygon::geometry)::json AS geometry_geojson,
        metadata,
        created_at,
        updated_at
      FROM operational_zones
      ORDER BY created_at DESC
    `,
  );

  return {
    zones: rows.map(mapZone),
  };
}

async function createZone(payload) {
  const polygonWkt = coordinatesToWkt(payload.coordinates);
  const { rows } = await query(
    `
      INSERT INTO operational_zones (
        name,
        type,
        status,
        color,
        polygon,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        ST_GeogFromText($5),
        $6::jsonb
      )
      RETURNING
        id,
        name,
        type,
        status,
        color,
        ST_AsGeoJSON(polygon::geometry)::json AS geometry_geojson,
        metadata,
        created_at,
        updated_at
    `,
    [
      payload.name,
      payload.type,
      payload.status,
      payload.color,
      polygonWkt,
      JSON.stringify(payload.metadata || {}),
    ],
  );

  return {
    zone: mapZone(rows[0]),
  };
}

async function updateZone(zoneId, payload) {
  const polygonWkt = coordinatesToWkt(payload.coordinates);
  const { rows, rowCount } = await query(
    `
      UPDATE operational_zones
      SET
        name = $2,
        type = $3,
        status = $4,
        color = $5,
        polygon = ST_GeogFromText($6),
        metadata = $7::jsonb
      WHERE id = $1
      RETURNING
        id,
        name,
        type,
        status,
        color,
        ST_AsGeoJSON(polygon::geometry)::json AS geometry_geojson,
        metadata,
        created_at,
        updated_at
    `,
    [
      zoneId,
      payload.name,
      payload.type,
      payload.status,
      payload.color,
      polygonWkt,
      JSON.stringify(payload.metadata || {}),
    ],
  );

  if (!rowCount) {
    const error = new Error("Zone not found.");
    error.status = 404;
    throw error;
  }

  return {
    zone: mapZone(rows[0]),
  };
}

async function deleteZone(zoneId) {
  const { rowCount } = await query(
    `
      DELETE FROM operational_zones
      WHERE id = $1
    `,
    [zoneId],
  );

  if (!rowCount) {
    const error = new Error("Zone not found.");
    error.status = 404;
    throw error;
  }
}

module.exports = {
  createZone,
  deleteZone,
  listZones,
  updateZone,
};
