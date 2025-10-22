const { pool, query } = require("../../../config/database");

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
    c.preferred_language,
    c.rating AS client_rating,
    c.total_trips AS client_total_trips,
    c.preferences AS client_preferences,
    c.created_at AS client_created_at,
    c.updated_at AS client_updated_at,
    d.license_number AS driver_license_number,
    d.vehicle_make AS driver_vehicle_make,
    d.vehicle_model AS driver_vehicle_model,
    d.vehicle_year AS driver_vehicle_year,
    d.vehicle_color AS driver_vehicle_color,
    d.vehicle_plate AS driver_vehicle_plate,
    d.vehicle_type AS driver_vehicle_type,
    d.rating AS driver_rating,
    d.total_trips AS driver_total_trips,
    d.status AS driver_status,
    d.documents AS driver_documents,
    d.onboarded_at AS driver_onboarded_at,
    d.created_at AS driver_created_at,
    d.updated_at AS driver_updated_at
  FROM users u
  LEFT JOIN clients c ON c.user_id = u.id
  LEFT JOIN drivers d ON d.user_id = u.id
`;

class AuthModel {
  static async findByEmail(email) {
    const normalizedEmail = email.toLowerCase();
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
    const normalizedEmail = email.toLowerCase();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const resolvedRole =
        accountType === "driver" ? "driver" : accountType === "client" ? "client" : role;

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
            phone_verification_sent_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `,
        [
          normalizedEmail,
          username ?? null,
          passwordHash,
          firstName ?? null,
          lastName ?? null,
          phoneNumber ?? null,
          resolvedRole,
          status,
          emailVerificationToken ?? null,
          emailVerificationSentAt ?? null,
          phoneVerificationToken ?? null,
          phoneVerificationSentAt ?? null,
        ]
      );

      const userId = userInsert.rows[0].id;

      if (accountType === "driver" && driverProfile) {
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
              documents
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
          ]
        );
      }

      if (accountType === "client" && clientProfile) {
        await client.query(
          `
            INSERT INTO clients (
              user_id,
              default_payment_method,
              preferred_language,
              preferences
            )
            VALUES ($1, $2, $3, $4)
          `,
          [
            userId,
            clientProfile.defaultPaymentMethod ?? null,
            clientProfile.preferredLanguage ?? null,
            JSON.stringify(clientProfile.preferences ?? {}),
          ]
        );
      }

      await client.query("COMMIT");

      return this.findById(userId);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        const conflictField = error.detail?.includes("(email)")
          ? "Email"
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
    const clientProfile =
      row.default_payment_method !== null ||
      row.preferred_language !== null ||
      row.client_rating !== null ||
      row.client_total_trips !== null
        ? {
            defaultPaymentMethod: row.default_payment_method,
            preferredLanguage: row.preferred_language,
            rating: row.client_rating,
            totalTrips: row.client_total_trips,
            preferences: row.client_preferences,
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
          rating: row.driver_rating,
          totalTrips: row.driver_total_trips,
          status: row.driver_status,
          documents: row.driver_documents,
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
      profile: row.profile,
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
