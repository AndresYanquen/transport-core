const { pool, query } = require("../../../config/database");
const { normalizePhoneNumber } = require("../utils/phone");

const baseUserSelect = `
  SELECT
    u.id,
    u.email,
    u.username,
    u.password_hash,
    u.first_name,
    u.last_name,
    u.phone_number,
    u.role,
    u.status,
    u.email_verified,
    u.phone_verified,
    u.email_verification_token,
    u.email_verification_sent_at,
    u.phone_verification_token,
    u.phone_verification_sent_at,
    u.last_login_at,
    u.profile,
    u.created_at,
    u.updated_at,
    u.deleted_at,
    c.default_payment_method,
    c.rating AS client_rating,
    (
      SELECT COUNT(*)::integer
      FROM rides r
      WHERE r.client_id = u.id
        AND r.status = 'completed'
    ) AS client_total_trips,
    c.created_at AS client_created_at,
    c.updated_at AS client_updated_at,
    d.license_number AS driver_license_number,
    d.vehicle_make AS driver_vehicle_make,
    d.vehicle_model AS driver_vehicle_model,
    d.vehicle_year AS driver_vehicle_year,
    d.vehicle_color AS driver_vehicle_color,
    d.vehicle_plate AS driver_vehicle_plate,
    d.vehicle_type AS driver_vehicle_type,
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
    ) AS driver_service_types,
    d.rating AS driver_rating,
    (
      SELECT COUNT(*)::integer
      FROM rides r
      WHERE r.driver_id = u.id
        AND r.status = 'completed'
    ) AS driver_total_trips,
    d.status AS driver_status,
    d.documents AS driver_documents,
    d.onboarded_at AS driver_onboarded_at,
    d.created_at AS driver_created_at,
    d.updated_at AS driver_updated_at,
    ST_AsGeoJSON(c.home_location)::json AS client_home_location,
    ST_AsGeoJSON(d.current_location)::json AS driver_current_location
  FROM users u
  LEFT JOIN clients c ON c.user_id = u.id
  LEFT JOIN drivers d ON d.user_id = u.id
`;

class AuthModel {
  static async findByEmail(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) return null;

    const { rows } = await query(
      `
        ${baseUserSelect}
        WHERE u.email = $1
          AND u.deleted_at IS NULL
      `,
      [normalizedEmail]
    );

    return rows[0] ?? null;
  }

  static async findById(id) {
    const { rows } = await query(
      `
        ${baseUserSelect}
        WHERE u.id = $1
          AND u.deleted_at IS NULL
      `,
      [id]
    );

    return rows[0] ?? null;
  }

  static async findClientByPhoneNumber(phoneNumber) {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) return null;

    const { rows } = await query(
      `
        ${baseUserSelect}
        WHERE u.role = 'client'
          AND u.phone_number = $1
          AND u.deleted_at IS NULL
        ORDER BY u.created_at ASC
        LIMIT 1
      `,
      [normalizedPhone]
    );

    return rows[0] ?? null;
  }

  static async createPhoneOnlyClient({
    phoneNumber,
    firstName,
    lastName,
    createdByOperatorId,
  }) {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
      throw new Error("phoneNumber is required.");
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const profile = {
        phoneOnly: true,
        source: "operator_phone_call",
        createdByOperatorId: createdByOperatorId || null,
      };

      const userInsert = await client.query(
        `
          INSERT INTO users (
            email,
            username,
            password_hash,
            first_name,
            last_name,
            phone_number,
            role,
            status,
            phone_verified,
            profile
          )
          VALUES ($1, NULL, $2, $3, $4, $5, 'client', 'active', false, $6::jsonb)
          RETURNING id
        `,
        [
          null,
          null,
          firstName ?? null,
          lastName ?? null,
          normalizedPhone,
          JSON.stringify(profile),
        ]
      );

      const userId = userInsert.rows[0].id;

      await client.query(
        `
          INSERT INTO clients (user_id)
          VALUES ($1)
        `,
        [userId]
      );

      await client.query("COMMIT");
      return this.findById(userId);
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        error.code === "23505" &&
        (error.constraint === "users_client_phone_unique_not_null" ||
          error.detail?.includes("(phone_number)"))
      ) {
        return this.findClientByPhoneNumber(normalizedPhone);
      }

      throw error;
    } finally {
      client.release();
    }
  }

  static async createUser({
    email,
    passwordHash,
    firstName,
    lastName,
    phoneNumber,
    username,
    role = "user",
    status = "active",
    emailVerificationToken,
    emailVerificationSentAt,
    phoneVerificationToken,
    phoneVerificationSentAt,
    accountType = "client",
    clientProfile,
    driverProfile,
  }) {
    const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
    const normalizedPhone = phoneNumber ? normalizePhoneNumber(phoneNumber) : null;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const resolvedRole = ["admin", "operator", "driver", "client"].includes(accountType)
        ? accountType
        : role;
      const profile = {};
      if (accountType === "client" && clientProfile) {
        const preferences = {
          ...(clientProfile.preferences ?? {}),
        };

        if (clientProfile.preferredLanguage) {
          preferences.language = clientProfile.preferredLanguage;
        }

        if (Object.keys(preferences).length) {
          profile.preferences = preferences;
        }
      }

      const userInsert = await client.query(
        `
          INSERT INTO users (
            email,
            username,
            password_hash,
            first_name,
            last_name,
            phone_number,
            role,
            status,
            email_verification_token,
            email_verification_sent_at,
            phone_verification_token,
            phone_verification_sent_at,
            profile
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
          RETURNING id
        `,
        [
          normalizedEmail,
          username ?? null,
          passwordHash,
          firstName ?? null,
          lastName ?? null,
          normalizedPhone,
          resolvedRole,
          status,
          emailVerificationToken ?? null,
          emailVerificationSentAt ?? null,
          phoneVerificationToken ?? null,
          phoneVerificationSentAt ?? null,
          JSON.stringify(profile),
        ]
      );

      const userId = userInsert.rows[0].id;

      if (accountType === "driver" && driverProfile) {
        const locationLat = driverProfile.currentLocationLatLng
          ? driverProfile.currentLocationLatLng.lat
          : null;
        const locationLng = driverProfile.currentLocationLatLng
          ? driverProfile.currentLocationLatLng.lng
          : null;

        await client.query(
          `
            INSERT INTO drivers (
              user_id,
              license_number,
              vehicle_make,
              vehicle_model,
              vehicle_year,
              vehicle_color,
              vehicle_plate,
              vehicle_type,
              documents,
              current_location
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              CASE
                WHEN $10::double precision IS NULL OR $11::double precision IS NULL
                  THEN NULL
                ELSE ST_SetSRID(
                  ST_MakePoint($11::double precision, $10::double precision),
                  4326
                )::geography
              END
            )
          `,
          [
            userId,
            driverProfile.licenseNumber,
            driverProfile.vehicleMake,
            driverProfile.vehicleModel,
            driverProfile.vehicleYear ?? null,
            driverProfile.vehicleColor ?? null,
            driverProfile.vehiclePlate,
            driverProfile.vehicleType ?? null,
            JSON.stringify(driverProfile.documents ?? {}),
            locationLat,
            locationLng,
          ]
        );

        await client.query(
          `
            INSERT INTO driver_service_types (driver_id, service_type_code, is_active)
            VALUES ($1, $2, true)
            ON CONFLICT (driver_id, service_type_code)
            DO UPDATE SET is_active = true, updated_at = NOW()
          `,
          [userId, driverProfile.serviceType || "standard"]
        );
      }

      if (accountType === "client" && clientProfile) {
        await client.query(
          `
            INSERT INTO clients (
              user_id,
              default_payment_method,
              home_location
            )
            VALUES (
              $1,
              $2,
              CASE WHEN $3::text IS NULL THEN NULL ELSE ST_GeogFromText($3::text) END
            )
          `,
          [
            userId,
            clientProfile.defaultPaymentMethod ?? null,
            clientProfile.homeLocationWkt ?? null,
          ]
        );
      }

      await client.query("COMMIT");

      return this.findById(userId);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        const conflictField = error.detail?.includes("lower(email)") ||
          error.constraint === "users_email_unique_not_null" ||
          error.detail?.includes("(email)")
          ? "Email"
          : error.detail?.includes("(phone_number)") ||
            error.constraint === "users_client_phone_unique_not_null"
          ? "Phone number"
          : error.detail?.includes("(username)")
          ? "Username"
          : error.detail?.includes("(license_number)")
          ? "Driver license"
          : "Account";

        const conflictError = new Error(`${conflictField} already registered.`);
        conflictError.status = 409;
        throw conflictError;
      }

      throw error;
    } finally {
      client.release();
    }
  }

  static async updateLastLogin(userId) {
    const { rows } = await query(
      `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
        RETURNING id
      `,
      [userId]
    );

    if (!rows[0]) {
      return null;
    }

    return this.findById(rows[0].id);
  }

  static toPublicUser(row) {
    if (!row) return null;
    const userProfile = row.profile ?? {};
    const userPreferences = userProfile?.preferences ?? {};
    const clientPreferredLanguage = userPreferences?.language ?? null;
    const clientProfile =
      row.default_payment_method !== null ||
      clientPreferredLanguage !== null ||
      row.client_rating !== null ||
      row.client_total_trips !== null ||
      row.client_home_location !== null
        ? {
            defaultPaymentMethod: row.default_payment_method,
            preferredLanguage: clientPreferredLanguage,
            rating: row.client_rating,
            totalTrips: row.client_total_trips,
            homeLocation: row.client_home_location,
            createdAt: row.client_created_at,
            updatedAt: row.client_updated_at,
          }
        : null;

    const driverProfile = row.driver_license_number
      ? {
          licenseNumber: row.driver_license_number,
          vehicleMake: row.driver_vehicle_make,
          vehicleModel: row.driver_vehicle_model,
          vehicleYear: row.driver_vehicle_year,
          vehicleColor: row.driver_vehicle_color,
          vehiclePlate: row.driver_vehicle_plate,
          vehicleType: row.driver_vehicle_type,
          serviceTypes: row.driver_service_types || [],
          rating: row.driver_rating,
          totalTrips: row.driver_total_trips,
          status: row.driver_status,
          documents: row.driver_documents,
          currentLocation: row.driver_current_location,
          onboardedAt: row.driver_onboarded_at,
          createdAt: row.driver_created_at,
          updatedAt: row.driver_updated_at,
        }
      : null;

    return {
      id: row.id,
      email: row.email,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      phoneNumber: row.phone_number,
      role: row.role,
      status: row.status,
      emailVerified: row.email_verified,
      phoneVerified: row.phone_verified,
      profile: userProfile,
      clientProfile,
      driverProfile,
      emailVerificationSentAt: row.email_verification_sent_at,
      phoneVerificationSentAt: row.phone_verification_sent_at,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }
}

module.exports = AuthModel;
