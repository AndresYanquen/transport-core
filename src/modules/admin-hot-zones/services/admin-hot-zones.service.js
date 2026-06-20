const { query } = require("../../../config/database");
const { env } = require("../../../config");

const VALID_RIDE_STATUSES = new Set([
  "all", "requested", "pending_driver", "driver_assigned", "driver_en_route",
  "driver_arrived", "in_progress", "completed",
]);
const ACTIVE_STATUSES = [
  "requested", "pending_driver", "driver_assigned", "driver_en_route",
  "driver_arrived", "in_progress",
];

function parseDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function demandLevel(requests, availableDrivers) {
  const deficit = requests - availableDrivers;
  if (requests >= 8 || deficit >= 5) return "critical";
  if (requests >= 5 || deficit >= 3) return "high";
  if (requests >= 2 || deficit >= 1) return "medium";
  return "low";
}

function mapPoint(geojson) {
  const coordinates = geojson?.coordinates;
  return Array.isArray(coordinates) ? { lat: coordinates[1], lng: coordinates[0] } : null;
}

function abbreviatedName(firstName, lastName) {
  const first = String(firstName || "").trim();
  const initial = String(lastName || "").trim().slice(0, 1);
  return [first, initial ? `${initial}.` : ""].filter(Boolean).join(" ") || "Cliente";
}

async function getSnapshot(filters = {}) {
  const now = new Date();
  const from = parseDate(filters.from, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const to = parseDate(filters.to, now);
  const status = VALID_RIDE_STATUSES.has(filters.status) ? filters.status : "all";
  const serviceType = typeof filters.serviceType === "string" && filters.serviceType.trim()
    ? filters.serviceType.trim()
    : "all";

  const [zonesResult, requestsResult, driversResult, coverageResult, servicesResult] = await Promise.all([
    query(
      `
        SELECT
          z.id, z.name, z.type, z.status, z.color,
          ST_AsGeoJSON(z.polygon::geometry)::json AS geometry_geojson,
          COALESCE(r.total_requests, 0)::integer AS total_requests,
          COALESCE(r.active_requests, 0)::integer AS active_requests,
          COALESCE(r.average_wait_seconds, 0)::integer AS average_wait_seconds,
          COALESCE(d.available_drivers, 0)::integer AS available_drivers,
          COALESCE(d.total_drivers, 0)::integer AS total_drivers
        FROM operational_zones z
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) AS total_requests,
            COUNT(*) FILTER (WHERE rides.status = ANY($5::text[])) AS active_requests,
            AVG(EXTRACT(EPOCH FROM (COALESCE(rides.accepted_at, rides.updated_at) - rides.requested_at)))
              FILTER (WHERE rides.accepted_at IS NOT NULL) AS average_wait_seconds
          FROM rides
          WHERE rides.pickup_point IS NOT NULL
            AND ST_Covers(z.polygon::geometry, rides.pickup_point::geometry)
            AND rides.requested_at >= $1
            AND rides.requested_at <= $2
            AND ($3 = 'all' OR rides.status = $3)
            AND ($4 = 'all' OR rides.service_type = $4)
        ) r ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (
              WHERE drivers.status = 'online'
                AND drivers.last_seen_at >= NOW() - ($6::double precision * INTERVAL '1 second')
            ) AS available_drivers,
            COUNT(*) FILTER (WHERE drivers.status IN ('online', 'busy')) AS total_drivers
          FROM drivers
          WHERE drivers.current_location IS NOT NULL
            AND ST_Covers(z.polygon::geometry, drivers.current_location::geometry)
        ) d ON true
        WHERE z.status = 'active'
        ORDER BY z.name ASC
      `,
      [from.toISOString(), to.toISOString(), status, serviceType, ACTIVE_STATUSES, env.driverPresence.staleAfterSeconds],
    ),
    query(
      `
        SELECT
          r.id, r.status, r.service_type, r.pickup_address, r.requested_at, r.updated_at,
          ST_AsGeoJSON(r.pickup_point::geometry)::json AS pickup_geojson,
          u.first_name, u.last_name,
          st.name AS service_name, st.color AS service_color,
          z.id AS zone_id, z.name AS zone_name
        FROM rides r
        JOIN users u ON u.id = r.client_id
        JOIN service_types st ON st.code = r.service_type
        LEFT JOIN LATERAL (
          SELECT oz.id, oz.name
          FROM operational_zones oz
          WHERE oz.status = 'active'
            AND ST_Covers(oz.polygon::geometry, r.pickup_point::geometry)
          ORDER BY CASE oz.type WHEN 'hot_zone' THEN 1 ELSE 2 END, oz.created_at ASC
          LIMIT 1
        ) z ON true
        WHERE r.pickup_point IS NOT NULL
          AND r.status = ANY($1::text[])
          AND ($2 = 'all' OR r.service_type = $2)
        ORDER BY r.requested_at DESC
        LIMIT 500
      `,
      [ACTIVE_STATUSES, serviceType],
    ),
    query(
      `
        SELECT
          d.user_id, d.heading_degrees, d.vehicle_make, d.vehicle_model,
          d.vehicle_color, d.vehicle_plate, d.status, d.availability_intent,
          d.last_seen_at, d.offline_reason, d.updated_at,
          ST_AsGeoJSON(d.current_location::geometry)::json AS location_geojson,
          u.first_name, u.last_name,
          z.id AS zone_id, z.name AS zone_name
        FROM drivers d
        JOIN users u ON u.id = d.user_id
        LEFT JOIN LATERAL (
          SELECT oz.id, oz.name
          FROM operational_zones oz
          WHERE oz.status = 'active'
            AND ST_Covers(oz.polygon::geometry, d.current_location::geometry)
          ORDER BY CASE oz.type WHEN 'hot_zone' THEN 1 ELSE 2 END, oz.created_at ASC
          LIMIT 1
        ) z ON true
        WHERE d.status = 'online'
          AND d.last_seen_at >= NOW() - ($1::double precision * INTERVAL '1 second')
          AND d.current_location IS NOT NULL
        ORDER BY d.updated_at DESC
        LIMIT 3000
      `,
      [env.driverPresence.staleAfterSeconds],
    ),
    query(
      `
        SELECT ST_AsGeoJSON(ST_Union(polygon::geometry))::json AS geometry_geojson
        FROM operational_zones
        WHERE status = 'active'
      `,
    ),
    query(
      `
        SELECT code, name, color
        FROM service_types
        WHERE is_active = true
        ORDER BY sort_order ASC, name ASC
      `,
    ),
  ]);

  const zones = zonesResult.rows.map((row) => {
    const requests = Number(row.total_requests);
    const activeRequests = Number(row.active_requests);
    const availableDrivers = Number(row.available_drivers);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      color: row.color,
      coordinates: row.geometry_geojson?.coordinates?.[0] || [],
      metrics: {
        requests,
        activeRequests,
        availableDrivers,
        totalDrivers: Number(row.total_drivers),
        averageWaitSeconds: Number(row.average_wait_seconds),
        deficit: activeRequests - availableDrivers,
        level: demandLevel(activeRequests || requests, availableDrivers),
      },
    };
  });

  return {
    server: { now: now.toISOString() },
    filters: { from: from.toISOString(), to: to.toISOString(), status, serviceType },
    coverage: coverageResult.rows[0]?.geometry_geojson || null,
    serviceTypes: servicesResult.rows.map((row) => ({
      code: row.code, name: row.name, color: row.color || "#2563EB",
    })),
    requests: requestsResult.rows.map((row) => ({
      id: row.id,
      status: row.status,
      serviceType: row.service_type,
      serviceName: row.service_name,
      serviceColor: row.service_color || "#7C3AED",
      pickupAddress: row.pickup_address,
      pickupLocation: mapPoint(row.pickup_geojson),
      clientName: abbreviatedName(row.first_name, row.last_name),
      zoneId: row.zone_id || null,
      zoneName: row.zone_name || "Fuera de zona",
      requestedAt: row.requested_at,
      updatedAt: row.updated_at,
    })),
    drivers: driversResult.rows.map((row) => ({
      userId: row.user_id,
      name: abbreviatedName(row.first_name, row.last_name),
      status: row.status,
      availabilityIntent: row.availability_intent,
      lastSeenAt: row.last_seen_at,
      offlineReason: row.offline_reason,
      location: mapPoint(row.location_geojson),
      headingDegrees: row.heading_degrees === null ? 0 : Number(row.heading_degrees),
      zoneId: row.zone_id || null,
      zoneName: row.zone_name || "Fuera de zona",
      updatedAt: row.updated_at,
      vehicle: {
        make: row.vehicle_make,
        model: row.vehicle_model,
        color: row.vehicle_color,
        plate: row.vehicle_plate,
      },
    })),
    totals: zones.reduce(
      (totals, zone) => ({
        requests: totals.requests + zone.metrics.requests,
        activeRequests: totals.activeRequests + zone.metrics.activeRequests,
        availableDrivers: totals.availableDrivers + zone.metrics.availableDrivers,
        deficit: totals.deficit + zone.metrics.deficit,
      }),
      { requests: 0, activeRequests: 0, availableDrivers: 0, deficit: 0 },
    ),
    zones,
  };
}

module.exports = { getSnapshot };
