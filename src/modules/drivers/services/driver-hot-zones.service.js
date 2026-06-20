const Database = require("../../../config/database");
const DriverModel = require("../models/driver.model");

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function demandLevel(count) {
  if (count >= 8) return "critical";
  if (count >= 5) return "high";
  if (count >= 2) return "medium";
  return "low";
}

const APPROXIMATE_PICKUP_GRID_METERS = 250;
const APPROXIMATE_PICKUP_RADIUS_METERS = 250;

async function getSnapshot(driverId, filters = {}) {
  const driverServiceTypes = await DriverModel.listServiceTypes(driverId);
  const enabledServiceTypes = driverServiceTypes
    .filter((service) => service.isActive && service.driverIsActive)
    .map((service) => ({
      code: service.code,
      name: service.name,
      color: service.color || "#2563EB",
    }));
  const enabledCodes = new Set(enabledServiceTypes.map((service) => service.code));
  const requestedServiceType =
    typeof filters.serviceType === "string" && filters.serviceType.trim()
      ? filters.serviceType.trim()
      : "all";

  if (requestedServiceType !== "all" && !enabledCodes.has(requestedServiceType)) {
    throw createHttpError(
      403,
      "The requested service type is not enabled for this driver."
    );
  }

  const [zonesResult, coverageResult, serviceCounts] = await Promise.all([
    Database.query(
      `
        SELECT
          id,
          name,
          type,
          color,
          ST_AsGeoJSON(polygon::geometry)::json AS geometry_geojson
        FROM operational_zones
        WHERE status = 'active'
        ORDER BY name ASC
      `
    ),
    Database.query(
      `
        SELECT ST_AsGeoJSON(ST_Union(polygon::geometry))::json AS geometry_geojson
        FROM operational_zones
        WHERE status = 'active'
      `
    ),
    listAvailableRequestCountsByZone({
      enabledServiceTypeCodes: [...enabledCodes],
      serviceType: requestedServiceType,
    }),
  ]);

  const zones = zonesResult.rows.map((row) => {
    const counts = serviceCounts.get(row.id) || [];
    const availableRequests = counts.reduce((sum, item) => sum + item.count, 0);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      color: row.color,
      coordinates: row.geometry_geojson?.coordinates?.[0] || [],
      availableRequestsByService: counts,
      metrics: {
        availableRequests,
        level: demandLevel(availableRequests),
      },
    };
  });
  const totalAvailableRequests = zones.reduce(
    (sum, zone) => sum + zone.metrics.availableRequests,
    0
  );

  return {
    server: { now: new Date().toISOString() },
    filters: { serviceType: requestedServiceType },
    coverage: coverageResult.rows[0]?.geometry_geojson || null,
    serviceTypes: enabledServiceTypes,
    totals: { availableRequests: totalAvailableRequests },
    zones,
  };
}

async function getEnabledServiceTypes(driverId) {
  const serviceTypes = await DriverModel.listServiceTypes(driverId);
  return serviceTypes
    .filter((service) => service.isActive && service.driverIsActive)
    .map((service) => ({
      code: service.code,
      name: service.name,
      color: service.color || "#2563EB",
    }));
}

async function listAvailableRequestCountsByZone({
  enabledServiceTypeCodes,
  serviceType = "all",
}) {
  if (!enabledServiceTypeCodes.length) return new Map();

  const { rows } = await Database.query(
    `
      SELECT
        z.id AS zone_id,
        r.service_type,
        st.name AS service_name,
        st.color AS service_color,
        COUNT(*)::integer AS request_count
      FROM operational_zones z
      JOIN rides r
        ON r.pickup_point IS NOT NULL
       AND ST_Covers(z.polygon::geometry, r.pickup_point::geometry)
      JOIN service_types st ON st.code = r.service_type
      WHERE z.status = 'active'
        AND r.status IN ('requested', 'pending_driver')
        AND r.driver_id IS NULL
        AND r.service_type = ANY($1::text[])
        AND ($2 = 'all' OR r.service_type = $2)
      GROUP BY z.id, r.service_type, st.name, st.color, st.sort_order
      ORDER BY z.id, st.sort_order ASC, st.name ASC
    `,
    [enabledServiceTypeCodes, serviceType]
  );

  const counts = new Map();
  for (const row of rows) {
    if (!counts.has(row.zone_id)) counts.set(row.zone_id, []);
    counts.get(row.zone_id).push({
      serviceType: row.service_type,
      serviceName: row.service_name,
      serviceColor: row.service_color || "#2563EB",
      count: Number(row.request_count),
    });
  }
  return counts;
}

async function listZoneRequests(driverId, zoneId, filters = {}) {
  const enabledServiceTypes = await getEnabledServiceTypes(driverId);
  const enabledCodes = enabledServiceTypes.map((service) => service.code);
  const requestedServiceType =
    typeof filters.serviceType === "string" && filters.serviceType.trim()
      ? filters.serviceType.trim()
      : "all";

  if (requestedServiceType !== "all" && !enabledCodes.includes(requestedServiceType)) {
    throw createHttpError(403, "The requested service type is not enabled for this driver.");
  }

  const limit = filters.limit;
  const page = filters.page;
  const offset = (page - 1) * limit;
  const { rows } = await Database.query(
    `
      SELECT
        z.id AS zone_id,
        z.name AS zone_name,
        r.id,
        r.service_type,
        r.requested_at,
        st.name AS service_name,
        st.color AS service_color,
        EXTRACT(EPOCH FROM (NOW() - r.requested_at))::integer AS request_age_seconds,
        CASE
          WHEN d.current_location IS NULL THEN NULL
          ELSE ST_Distance(d.current_location, r.pickup_point)
        END AS distance_from_driver_meters,
        ST_Y(
          ST_Transform(
            ST_SnapToGrid(
              ST_Transform(r.pickup_point::geometry, 3857),
              ${APPROXIMATE_PICKUP_GRID_METERS}
            ),
            4326
          )
        ) AS approximate_pickup_lat,
        ST_X(
          ST_Transform(
            ST_SnapToGrid(
              ST_Transform(r.pickup_point::geometry, 3857),
              ${APPROXIMATE_PICKUP_GRID_METERS}
            ),
            4326
          )
        ) AS approximate_pickup_lng,
        COUNT(*) OVER()::integer AS total_count
      FROM operational_zones z
      JOIN rides r
        ON r.pickup_point IS NOT NULL
       AND ST_Covers(z.polygon::geometry, r.pickup_point::geometry)
      JOIN service_types st ON st.code = r.service_type
      JOIN drivers d ON d.user_id = $6
      WHERE z.id = $1
        AND z.status = 'active'
        AND r.status IN ('requested', 'pending_driver')
        AND r.driver_id IS NULL
        AND r.service_type = ANY($2::text[])
        AND ($3 = 'all' OR r.service_type = $3)
      ORDER BY r.requested_at ASC, r.id ASC
      LIMIT $4 OFFSET $5
    `,
    [zoneId, enabledCodes, requestedServiceType, limit, offset, driverId]
  );

  if (!rows.length && page === 1) {
    const zoneResult = await Database.query(
      `SELECT id, name FROM operational_zones WHERE id = $1 AND status = 'active'`,
      [zoneId]
    );
    if (!zoneResult.rows[0]) throw createHttpError(404, "Zone not found.");
  }

  const total = Number(rows[0]?.total_count || 0);
  return {
    zone: {
      id: rows[0]?.zone_id || zoneId,
      name: rows[0]?.zone_name || null,
    },
    filters: { serviceType: requestedServiceType },
    pagination: {
      page,
      limit,
      total,
      totalPages: total ? Math.ceil(total / limit) : 0,
    },
    requests: rows.map((row) => ({
      id: row.id,
      serviceType: row.service_type,
      serviceName: row.service_name,
      serviceColor: row.service_color || "#2563EB",
      requestedAt: row.requested_at,
      requestAgeSeconds: Number(row.request_age_seconds || 0),
      distanceFromDriverMeters:
        row.distance_from_driver_meters === null
          ? null
          : Math.round(Number(row.distance_from_driver_meters)),
      approximatePickup: {
        lat: Number(row.approximate_pickup_lat),
        lng: Number(row.approximate_pickup_lng),
        radiusMeters: APPROXIMATE_PICKUP_RADIUS_METERS,
      },
    })),
  };
}

module.exports = {
  getSnapshot,
  listZoneRequests,
  __private: { listAvailableRequestCountsByZone },
};
