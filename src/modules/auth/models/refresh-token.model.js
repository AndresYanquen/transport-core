const { pool, query } = require("../../../config/database");

class RefreshTokenModel {
  static async create({
    userId,
    tokenHash,
    familyId,
    expiresAt,
    ip,
    userAgent,
  }, client = null) {
    const executor = client || pool;
    const { rows } = await executor.query(
      `
        INSERT INTO auth_refresh_tokens (
          user_id,
          token_hash,
          family_id,
          expires_at,
          created_by_ip,
          created_by_user_agent
        )
        VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()), $4, $5, $6)
        RETURNING *
      `,
      [
        userId,
        tokenHash,
        familyId || null,
        expiresAt,
        ip || null,
        userAgent || null,
      ]
    );

    return rows[0] ?? null;
  }

  static async findByHash(tokenHash) {
    const { rows } = await query(
      `
        SELECT *
        FROM auth_refresh_tokens
        WHERE token_hash = $1
      `,
      [tokenHash]
    );

    return rows[0] ?? null;
  }

  static async rotate({
    currentTokenHash,
    newTokenHash,
    expiresAt,
    ip,
    userAgent,
  }) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const currentResult = await client.query(
        `
          SELECT *
          FROM auth_refresh_tokens
          WHERE token_hash = $1
          FOR UPDATE
        `,
        [currentTokenHash]
      );
      const currentToken = currentResult.rows[0] ?? null;

      if (!currentToken) {
        await client.query("ROLLBACK");
        return { currentToken: null, newToken: null };
      }

      if (currentToken.revoked_at) {
        await client.query("COMMIT");
        return { currentToken, newToken: null };
      }

      const newToken = await this.create({
        userId: currentToken.user_id,
        tokenHash: newTokenHash,
        familyId: currentToken.family_id,
        expiresAt,
        ip,
        userAgent,
      }, client);

      const revokedResult = await client.query(
        `
          UPDATE auth_refresh_tokens
          SET
            revoked_at = NOW(),
            replaced_by_token_id = $2,
            revoked_reason = 'rotated'
          WHERE id = $1
          RETURNING *
        `,
        [currentToken.id, newToken.id]
      );

      await client.query("COMMIT");
      return {
        currentToken: revokedResult.rows[0] ?? currentToken,
        newToken,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async revokeByHash(tokenHash, reason = "revoked") {
    const { rows } = await query(
      `
        UPDATE auth_refresh_tokens
        SET
          revoked_at = COALESCE(revoked_at, NOW()),
          revoked_reason = COALESCE(revoked_reason, $2)
        WHERE token_hash = $1
        RETURNING *
      `,
      [tokenHash, reason]
    );

    return rows[0] ?? null;
  }

  static async revokeFamily(familyId, reason = "family_revoked") {
    const { rows } = await query(
      `
        UPDATE auth_refresh_tokens
        SET
          revoked_at = COALESCE(revoked_at, NOW()),
          revoked_reason = COALESCE(revoked_reason, $2)
        WHERE family_id = $1
          AND revoked_at IS NULL
        RETURNING *
      `,
      [familyId, reason]
    );

    return rows;
  }

  static async revokeAllForUser(userId, reason = "user_logout_all") {
    const { rows } = await query(
      `
        UPDATE auth_refresh_tokens
        SET
          revoked_at = COALESCE(revoked_at, NOW()),
          revoked_reason = COALESCE(revoked_reason, $2)
        WHERE user_id = $1
          AND revoked_at IS NULL
        RETURNING *
      `,
      [userId, reason]
    );

    return rows;
  }
}

module.exports = RefreshTokenModel;
