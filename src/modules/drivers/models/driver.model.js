const { pool, query } = require("../../../config/database");
const { env } = require("../../../config");

const BASE_DRIVER_FIELDS = `
  d.user_id,
  d.license_number,
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
  d.rating,
  (
    SELECT COUNT(*)::integer
    FROM rides r
    WHERE r.driver_id = d.user_id
      AND r.status = 'completed'
  ) AS total_trips,
  d.status,
  d.availability_intent,
  d.last_seen_at,
  d.offline_reason,
  d.documents,
  d.onboarded_at,
  d.approval_status,
  d.approval_notes,
  d.reviewed_by_admin_id,
  d.reviewed_at,
  d.created_at,
  d.updated_at,
  ST_AsGeoJSON(d.current_location)::json AS current_location_geojson,
  d.heading_degrees,
  d.speed_kmh,
  u.email,
  u.first_name,
  u.last_name,
  u.phone_number,
  u.profile_image_url
`;

function getExecutor(dbClient) {
  if (dbClient) {
    return dbClient;
  }

  return {
    query: (text, params) => query(text, params),
  };
}

function mapDriverRow(row) {
  if (!row) {
    return null;
  }

  const geometry = row.current_location_geojson;
  let currentLocation = null;

  if (geometry && geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    currentLocation = {
      lat: geometry.coordinates[1],
      lng: geometry.coordinates[0],
    };
  }

  return {
    userId: row.user_id,
    licenseNumber: row.license_number,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleYear: row.vehicle_year,
    vehicleColor: row.vehicle_color,
    vehiclePlate: row.vehicle_plate,
    vehicleType: row.vehicle_type,
    serviceTypes: row.service_types || [],
    rating: Number(row.rating ?? 0),
    totalTrips: Number(row.total_trips ?? 0),
    status: row.status,
    availabilityIntent: row.availability_intent,
    lastSeenAt: row.last_seen_at,
    offlineReason: row.offline_reason,
    documents: row.documents,
    onboardedAt: row.onboarded_at,
    approvalStatus: row.approval_status,
    approvalNotes: row.approval_notes,
    reviewedByAdminId: row.reviewed_by_admin_id,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentLocation,
    headingDegrees: row.heading_degrees,
    speedKmh: row.speed_kmh,
    contact: {
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      phoneNumber: row.phone_number,
      profileImageUrl: row.profile_image_url,
    },
    distanceMeters:
      row.distance_meters !== undefined && row.distance_meters !== null
        ? Number(row.distance_meters)
        : null,
  };
}

async function updateLocation(driverId, { currentLocationWkt, heading, speedKmh, hasLocation }, dbClient) {
  const executor = getExecutor(dbClient);
  const { rows } = await executor.query(
    `
      UPDATE drivers d
      SET
        status = CASE
          WHEN $4::boolean
            AND d.status = 'offline'
            AND d.availability_intent = 'online'
            THEN 'online'
          ELSE d.status
        END,
        current_location = CASE WHEN $4::boolean THEN ST_GeogFromText($1) ELSE current_location END,
        heading_degrees = CASE WHEN $4::boolean THEN COALESCE($2::double precision, heading_degrees) ELSE heading_degrees END,
        speed_kmh = CASE WHEN $4::boolean THEN COALESCE($3::double precision, speed_kmh) ELSE speed_kmh END,
        last_seen_at = NOW(),
        offline_reason = CASE
          WHEN d.status IN ('online', 'busy') THEN NULL
          WHEN $4::boolean
            AND d.status = 'offline'
            AND d.availability_intent = 'online'
            THEN NULL
          ELSE d.offline_reason
        END,
        updated_at = NOW()
      FROM users u
      WHERE d.user_id = $5
        AND u.id = d.user_id
      RETURNING ${BASE_DRIVER_FIELDS}
    `,
    [currentLocationWkt, heading ?? null, speedKmh ?? null, Boolean(hasLocation), driverId]
  );

  return mapDriverRow(rows[0]);
}

async function updateStatus(driverId, status, dbClient) {
  const executor = getExecutor(dbClient);
  const { rows } = await executor.query(
    `
      UPDATE drivers d
      SET status = CASE
            WHEN d.status = 'busy' AND $1 <> 'busy' THEN 'busy'
            ELSE $1
          END,
          availability_intent = CASE
            WHEN $1 = 'busy' THEN d.availability_intent
            ELSE $1
          END,
          last_seen_at = CASE WHEN $1 IN ('online', 'busy') THEN NOW() ELSE last_seen_at END,
          offline_reason = CASE WHEN $1 = 'offline' THEN 'driver_request' ELSE NULL END,
          updated_at = NOW()
      FROM users u
      WHERE d.user_id = $2
        AND u.id = d.user_id
      RETURNING ${BASE_DRIVER_FIELDS}
    `,
    [status, driverId]
  );

  return mapDriverRow(rows[0]);
}

async function getDriverById(driverId, { forUpdate = false, dbClient } = {}) {
  const executor = getExecutor(dbClient);
  const { rows } = await executor.query(
    `
      SELECT ${BASE_DRIVER_FIELDS}
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      WHERE d.user_id = $1
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [driverId]
  );

  return mapDriverRow(rows[0]);
}

async function findAvailableDriversNear(pointWkt, {
  radiusMeters = 2000,
  limit = 5,
  excludeDriverIds = [],
  serviceType = null,
  dbClient,
} = {}) {
  if (!pointWkt) {
    return [];
  }

  const executor = getExecutor(dbClient);
  const params = [pointWkt, env.driverPresence.staleAfterSeconds, radiusMeters];
  let excludeClause = "";
  let serviceTypeClause = "";

  if (excludeDriverIds.length > 0) {
    params.push(excludeDriverIds);
    excludeClause = `AND d.user_id <> ALL($${params.length}::uuid[])`;
  }

  if (serviceType) {
    params.push(serviceType);
    serviceTypeClause = `
      AND EXISTS (
        SELECT 1
        FROM driver_service_types dst
        JOIN service_types st ON st.code = dst.service_type_code
        WHERE dst.driver_id = d.user_id
          AND dst.service_type_code = $${params.length}
          AND dst.is_active = true
          AND st.is_active = true
      )
    `;
  }

  params.push(limit);
  const limitIndex = params.length;

  const { rows } = await executor.query(
    `
      SELECT
        ${BASE_DRIVER_FIELDS},
        ST_Distance(
          d.current_location,
          ST_GeogFromText($1)
        ) AS distance_meters
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      WHERE d.status = 'online'
        AND d.approval_status = 'approved'
        AND d.last_seen_at >= NOW() - ($2::double precision * INTERVAL '1 second')
        AND d.current_location IS NOT NULL
        AND ST_DWithin(d.current_location, ST_GeogFromText($1), $3)
        ${excludeClause}
        ${serviceTypeClause}
      ORDER BY distance_meters ASC
      LIMIT $${limitIndex}
    `,
    params
  );

  return rows.map(mapDriverRow);
}

async function restoreAvailability(driverId, dbClient) {
  const executor = getExecutor(dbClient);
  const { rows } = await executor.query(
    `
      UPDATE drivers d
      SET
        status = CASE
          WHEN availability_intent = 'online'
            AND last_seen_at >= NOW() - ($2::double precision * INTERVAL '1 second')
            THEN 'online'
          WHEN availability_intent = 'unavailable' THEN 'unavailable'
          ELSE 'offline'
        END,
        offline_reason = CASE
          WHEN availability_intent = 'online'
            AND last_seen_at < NOW() - ($2::double precision * INTERVAL '1 second')
            THEN 'heartbeat_timeout'
          WHEN availability_intent = 'offline' THEN COALESCE(offline_reason, 'driver_request')
          ELSE NULL
        END,
        updated_at = NOW()
      FROM users u
      WHERE d.user_id = $1
        AND u.id = d.user_id
      RETURNING ${BASE_DRIVER_FIELDS}
    `,
    [driverId, env.driverPresence.staleAfterSeconds]
  );
  return mapDriverRow(rows[0]);
}

async function expireStaleOnlineDrivers() {
  const { rows } = await query(
    `
      UPDATE drivers
      SET status = 'offline',
          offline_reason = 'heartbeat_timeout',
          updated_at = NOW()
      WHERE status = 'online'
        AND (last_seen_at IS NULL
          OR last_seen_at < NOW() - ($1::double precision * INTERVAL '1 second'))
      RETURNING user_id
    `,
    [env.driverPresence.staleAfterSeconds]
  );
  return rows.map((row) => row.user_id);
}

async function listServiceTypes(driverId, dbClient) {
  const executor = getExecutor(dbClient);
  const { rows } = await executor.query(
    `
      SELECT
        st.code,
        st.category,
        st.name,
        st.description,
        st.icon,
        st.color,
        st.base_price,
        st.is_active,
        st.sort_order,
        dst.is_active AS driver_is_active,
        dst.created_at,
        dst.updated_at
      FROM driver_service_types dst
      JOIN service_types st ON st.code = dst.service_type_code
      WHERE dst.driver_id = $1
      ORDER BY st.sort_order ASC, st.name ASC
    `,
    [driverId]
  );

  return rows.map((row) => ({
    code: row.code,
    category: row.category,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    basePrice: Number(row.base_price ?? 0),
    isActive: row.is_active,
    sortOrder: row.sort_order,
    driverIsActive: row.driver_is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function replaceServiceTypes(driverId, serviceTypeCodes, dbClient) {
  const executor = getExecutor(dbClient);
  const uniqueCodes = [...new Set(serviceTypeCodes)];

  const { rows: activeRows } = await executor.query(
    `
      SELECT code
      FROM service_types
      WHERE code = ANY($1::text[])
        AND is_active = true
    `,
    [uniqueCodes]
  );
  const activeCodes = activeRows.map((row) => row.code);

  if (activeCodes.length !== uniqueCodes.length) {
    const error = new Error("All service types must exist and be active.");
    error.status = 400;
    throw error;
  }

  await executor.query(
    `
      UPDATE driver_service_types
      SET is_active = false
      WHERE driver_id = $1
    `,
    [driverId]
  );

  for (const code of uniqueCodes) {
    await executor.query(
      `
        INSERT INTO driver_service_types (driver_id, service_type_code, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (driver_id, service_type_code)
        DO UPDATE SET is_active = true, updated_at = NOW()
      `,
      [driverId, code]
    );
  }

  return listServiceTypes(driverId, dbClient);
}

module.exports = {
  updateLocation,
  updateStatus,
  getDriverById,
  findAvailableDriversNear,
  restoreAvailability,
  expireStaleOnlineDrivers,
  listServiceTypes,
  replaceServiceTypes,
};
