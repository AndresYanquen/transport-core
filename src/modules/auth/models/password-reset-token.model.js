const { pool, query } = require("../../../config/database");
const { notifyRevoked } = require("../services/mobile-session-events");

class PasswordResetTokenModel {
  static async consumeAndResetPassword({ tokenHash, passwordHash }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT * FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE", [tokenHash]);
      const token = locked.rows[0];
      const valid = token && await client.query(`SELECT used_at IS NULL AND expires_at > clock_timestamp() AS valid
        FROM password_reset_tokens WHERE token_hash = $1`, [tokenHash]);
      if (!valid?.rows[0]?.valid) { await client.query("ROLLBACK"); return false; }
      const user = await client.query(`UPDATE users SET password_hash = $2, updated_at = clock_timestamp()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [token.user_id, passwordHash]);
      if (!user.rows.length) { await client.query("ROLLBACK"); return false; }
      await client.query("UPDATE password_reset_tokens SET used_at = clock_timestamp() WHERE token_hash = $1", [tokenHash]);
      const sessions = await client.query(`UPDATE auth_mobile_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
        revoked_reason = COALESCE(revoked_reason, 'password_reset') WHERE user_id = $1 RETURNING id`, [token.user_id]);
      await client.query(`UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
        revoked_reason = COALESCE(revoked_reason, 'password_reset') WHERE user_id = $1`, [token.user_id]);
      await client.query("COMMIT");
      notifyRevoked(sessions.rows.map((row) => row.id));
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  static async create({ userId, tokenHash, expiresAt }, client = null) {
    const executor = client || pool;
    const { rows } = await executor.query(
      `
        INSERT INTO password_reset_tokens (
          user_id,
          token_hash,
          expires_at
        )
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [userId, tokenHash, expiresAt]
    );

    return rows[0] ?? null;
  }

  static async findByHash(tokenHash) {
    const { rows } = await query(
      `
        SELECT *
        FROM password_reset_tokens
        WHERE token_hash = $1
      `,
      [tokenHash]
    );

    return rows[0] ?? null;
  }

  static async markUsed(tokenHash) {
    const { rows } = await query(
      `
        UPDATE password_reset_tokens
        SET used_at = COALESCE(used_at, NOW())
        WHERE token_hash = $1
        RETURNING *
      `,
      [tokenHash]
    );

    return rows[0] ?? null;
  }

  static async revokeUnusedForUser(userId) {
    const { rows } = await query(
      `
        UPDATE password_reset_tokens
        SET used_at = COALESCE(used_at, NOW())
        WHERE user_id = $1
          AND used_at IS NULL
        RETURNING *
      `,
      [userId]
    );

    return rows;
  }
}

module.exports = PasswordResetTokenModel;
