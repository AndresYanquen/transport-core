const { query } = require("../../../config/database");

const BASE_FIELDS = `
  upd.id,
  upd.user_id,
  upd.driver_id,
  upd.usage_count,
  upd.last_ride_at,
  upd.created_at,
  upd.updated_at,
  d.rating,
  d.status,
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
  u.first_name,
  u.last_name,
  u.phone_number
`;

function toPreferredDriver(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    driverId: row.driver_id,
    usageCount: Number(row.usage_count ?? 0),
    lastRideAt: row.last_ride_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    driver: {
      userId: row.driver_id,
      firstName: row.first_name,
      lastName: row.last_name,
      phoneNumber: row.phone_number,
      rating: Number(row.rating ?? 0),
      status: row.status,
      vehicle: {
        make: row.vehicle_make,
        model: row.vehicle_model,
        year: row.vehicle_year,
        color: row.vehicle_color,
        plate: row.vehicle_plate,
        type: row.vehicle_type,
        serviceTypes: row.service_types || [],
      },
    },
  };
}

class PreferredDriverModel {
  static async listByUserId(userId, { limit = 25 } = {}) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM user_preferred_drivers upd
        JOIN drivers d ON d.user_id = upd.driver_id
        JOIN users u ON u.id = d.user_id
        WHERE upd.user_id = $1
          AND upd.deleted_at IS NULL
        ORDER BY
          upd.usage_count DESC,
          upd.last_ride_at DESC NULLS LAST,
          upd.created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );

    return rows.map(toPreferredDriver);
  }

  static async findByDriverForUser(userId, driverId) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM user_preferred_drivers upd
        JOIN drivers d ON d.user_id = upd.driver_id
        JOIN users u ON u.id = d.user_id
        WHERE upd.user_id = $1
          AND upd.driver_id = $2
          AND upd.deleted_at IS NULL
      `,
      [userId, driverId]
    );

    return toPreferredDriver(rows[0]);
  }

  static async driverExists(driverId) {
    const { rows } = await query(
      `
        SELECT 1
        FROM drivers
        WHERE user_id = $1
        LIMIT 1
      `,
      [driverId]
    );

    return Boolean(rows[0]);
  }

  static async userCompletedRideWithDriver(userId, driverId) {
    const { rows } = await query(
      `
        SELECT completed_at
        FROM rides
        WHERE client_id = $1
          AND driver_id = $2
          AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, updated_at DESC
        LIMIT 1
      `,
      [userId, driverId]
    );

    return rows[0]?.completed_at ?? null;
  }

  static async createForUser(userId, driverId, { lastRideAt = null } = {}) {
    const { rows } = await query(
      `
        INSERT INTO user_preferred_drivers (
          user_id,
          driver_id,
          usage_count,
          last_ride_at
        )
        VALUES ($1, $2, 1, $3)
        RETURNING id
      `,
      [userId, driverId, lastRideAt]
    );

    return rows[0]?.id ?? null;
  }

  static async markUsedForUser(userId, driverId, { lastRideAt = null } = {}) {
    const { rows } = await query(
      `
        UPDATE user_preferred_drivers
        SET
          usage_count = usage_count + 1,
          last_ride_at = COALESCE($3, NOW())
        WHERE user_id = $1
          AND driver_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [userId, driverId, lastRideAt]
    );

    return rows[0]?.id ?? null;
  }

  static async softDeleteForUser(userId, driverId) {
    const { rows } = await query(
      `
        UPDATE user_preferred_drivers
        SET deleted_at = NOW()
        WHERE user_id = $1
          AND driver_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [userId, driverId]
    );

    return Boolean(rows[0]);
  }
}

module.exports = PreferredDriverModel;
