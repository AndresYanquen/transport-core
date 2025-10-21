const { query } = require("../../../config/database");

class AuthModel {
  static async findByEmail(email) {
    const normalizedEmail = email.toLowerCase();
    const { rows } = await query(
      `
        SELECT
          id,
          email,
          username,
          password_hash,
          first_name,
          last_name,
          phone_number,
          role,
          status,
          email_verified,
          phone_verified,
          email_verification_token,
          email_verification_sent_at,
          phone_verification_token,
          phone_verification_sent_at,
          last_login_at,
          created_at,
          updated_at,
          deleted_at
        FROM users
        WHERE email = $1
          AND deleted_at IS NULL
      `,
      [normalizedEmail]
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
  }) {
    const normalizedEmail = email.toLowerCase();

    try {
      const { rows } = await query(
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
          RETURNING
            id,
            email,
            username,
            first_name,
            last_name,
            phone_number,
            role,
            status,
            email_verified,
            phone_verified,
            created_at,
            updated_at
        `,
        [
          normalizedEmail,
          username ?? null,
          passwordHash,
          firstName ?? null,
          lastName ?? null,
          phoneNumber ?? null,
          role,
          status,
          emailVerificationToken ?? null,
          emailVerificationSentAt ?? null,
          phoneVerificationToken ?? null,
          phoneVerificationSentAt ?? null,
        ]
      );

      return rows[0];
    } catch (error) {
      if (error.code === "23505") {
        const conflictField = error.detail?.includes("(email)")
          ? "Email"
          : error.detail?.includes("(username)")
          ? "Username"
          : "Account";

        const conflictError = new Error(`${conflictField} already registered.`);
        conflictError.status = 409;
        throw conflictError;
      }

      throw error;
    }
  }

  static async updateLastLogin(userId) {
    const { rows } = await query(
      `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          email,
          username,
          password_hash,
          first_name,
          last_name,
          phone_number,
          role,
          status,
          email_verified,
          phone_verified,
          email_verification_token,
          email_verification_sent_at,
          phone_verification_token,
          phone_verification_sent_at,
          last_login_at,
          profile,
          created_at,
          updated_at,
          deleted_at
      `,
      [userId]
    );

    return rows[0] ?? null;
  }

  static toPublicUser(row) {
    if (!row) return null;
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
