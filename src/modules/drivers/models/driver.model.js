const { pool, query } = require("../../../config/database");

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
  d.documents,
  d.onboarded_at,
  d.created_at,
  d.updated_at,
  ST_AsGeoJSON(d.current_location)::json AS current_location_geojson,
  d.heading_degrees,
  d.speed_kmh,
  u.email,
  u.first_name,
  u.last_name,
  u.phone_number
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
    documents: row.documents,
    onboardedAt: row.onboarded_at,
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
    },
    distanceMeters:
      row.distance_meters !== undefined && row.distance_meters !== null
        ? Number(row.distance_meters)
        : null,
  };
}

async function updateLocation(driverId, { currentLocationWkt, heading, speedKmh }, dbClient) {
  const executor = getExecutor(dbClient);
  const { rows } = await executor.query(
    `
      UPDATE drivers d
      SET
        current_location = ST_GeogFromText($1),
        heading_degrees = COALESCE($2::double precision, heading_degrees),
        speed_kmh = COALESCE($3::double precision, speed_kmh),
        updated_at = NOW()
      FROM users u
      WHERE d.user_id = $4
        AND u.id = d.user_id
      RETURNING ${BASE_DRIVER_FIELDS}
    `,
    [currentLocationWkt, heading ?? null, speedKmh ?? null, driverId]
  );

  return mapDriverRow(rows[0]);
}

async function updateStatus(driverId, status, dbClient) {
  const executor = getExecutor(dbClient);
  const { rows } = await executor.query(
    `
      UPDATE drivers d
      SET status = $1,
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
  const params = [pointWkt, radiusMeters];
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
        AND d.current_location IS NOT NULL
        AND ST_DWithin(d.current_location, ST_GeogFromText($1), $2)
        ${excludeClause}
        ${serviceTypeClause}
      ORDER BY distance_meters ASC
      LIMIT $${limitIndex}
    `,
    params
  );

  return rows.map(mapDriverRow);
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
  listServiceTypes,
  replaceServiceTypes,
};
