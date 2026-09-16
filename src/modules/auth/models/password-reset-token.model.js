const { pool, query } = require("../../../config/database");

class PasswordResetTokenModel {
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
