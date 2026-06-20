const { query } = require("../../../config/database");
const { env } = require("../../../config");

function mapPointGeoJSON(pointGeojson) {
  if (!pointGeojson || pointGeojson.type !== "Point") return null;
  const coords = pointGeojson.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return { lat: coords[1], lng: coords[0] };
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapDriver(row) {
  return {
    userId: row.user_id,
    status: row.status,
    availabilityIntent: row.availability_intent,
    lastSeenAt: toIso(row.last_seen_at),
    offlineReason: row.offline_reason,
    updatedAt: toIso(row.updated_at),
    currentLocation: mapPointGeoJSON(row.current_location_geojson),
    headingDegrees: row.heading_degrees === null ? null : Number(row.heading_degrees),
    speedKmh: row.speed_kmh === null ? null : Number(row.speed_kmh),
    currentRideId: row.current_ride_id || null,
    vehicle: {
      make: row.vehicle_make,
      model: row.vehicle_model,
      year: row.vehicle_year,
      color: row.vehicle_color,
      plate: row.vehicle_plate,
      type: row.vehicle_type,
    },
    serviceTypes: row.service_types || [],
    contact: {
      email: row.email || "",
      firstName: row.first_name || "",
      lastName: row.last_name || "",
      phoneNumber: row.phone_number || "",
    },
  };
}

async function getDriversMapSnapshot() {
  const { rows } = await query(
    `
      SELECT
        d.user_id,
        d.status,
        d.availability_intent,
        d.last_seen_at,
        d.offline_reason,
        d.updated_at,
        d.heading_degrees,
        d.speed_kmh,
        d.vehicle_make,
        d.vehicle_model,
        d.vehicle_year,
        d.vehicle_color,
        d.vehicle_plate,
        d.vehicle_type,
        COALESCE(
          (
            SELECT array_agg(dst.service_type_code ORDER BY st.sort_order ASC, st.name ASC)
            FROM driver_service_types dst
            JOIN service_types st ON st.code = dst.service_type_code
            WHERE dst.driver_id = d.user_id
              AND dst.is_active = true
              AND st.is_active = true
          ),
          ARRAY[]::text[]
        ) AS service_types,
        ST_AsGeoJSON(d.current_location)::json AS current_location_geojson,
        u.email,
        u.first_name,
        u.last_name,
        u.phone_number,
        (
          SELECT r.id
          FROM rides r
          WHERE r.driver_id = d.user_id
            AND r.status NOT IN ('completed', 'canceled_by_client', 'canceled_by_driver', 'canceled_by_system', 'no_show')
          ORDER BY r.updated_at DESC
          LIMIT 1
        ) AS current_ride_id
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      ORDER BY
        CASE d.status
          WHEN 'busy' THEN 1
          WHEN 'online' THEN 2
          WHEN 'unavailable' THEN 3
          ELSE 4
        END,
        d.updated_at DESC
      LIMIT 3000
    `,
  );

  return {
    server: {
      now: new Date().toISOString(),
      realtimeEnabled: Boolean(env.realtime.enabled),
    },
    drivers: rows.map(mapDriver),
  };
}

module.exports = {
  getDriversMapSnapshot,
};
