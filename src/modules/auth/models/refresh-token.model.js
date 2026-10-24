const { pool, query } = require("../../../config/database");
const MobileSessionModel = require("./mobile-session.model");
const { notifyRevoked } = require("../services/mobile-session-events");

class RefreshTokenModel {
  static async create({
    userId,
    tokenHash,
    familyId,
    expiresAt,
    ip,
    userAgent,
    sessionId,
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
          created_by_user_agent,
          session_id
        )
        VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()), $4, $5, $6, $7)
        RETURNING *
      `,
      [
        userId,
        tokenHash,
        familyId || null,
        expiresAt,
        ip || null,
        userAgent || null,
        sessionId || null,
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

      // Lock the session before the token, matching logout/revocation order.
      const lookup = await client.query("SELECT user_id, session_id FROM auth_refresh_tokens WHERE token_hash = $1", [currentTokenHash]);
      let mobileSession = null;
      if (lookup.rows[0]?.session_id) {
        mobileSession = await MobileSessionModel.findActive(lookup.rows[0].session_id, lookup.rows[0].user_id, client, true);
        if (!mobileSession) {
          await client.query("ROLLBACK");
          return { currentToken: null, newToken: null };
        }
      }

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
      const valid = await client.query("SELECT expires_at > clock_timestamp() AS valid FROM auth_refresh_tokens WHERE id = $1", [currentToken.id]);
      if (!valid.rows[0]?.valid) {
        await client.query("ROLLBACK");
        return { currentToken, newToken: null };
      }

      if (mobileSession) {
        const updated = await client.query(`UPDATE auth_mobile_sessions SET
          expires_at = LEAST($2::timestamptz, absolute_expires_at), last_used_at = clock_timestamp()
          WHERE id = $1 AND revoked_at IS NULL AND absolute_expires_at > clock_timestamp() RETURNING *`, [mobileSession.id, expiresAt]);
        mobileSession = updated.rows[0];
        if (!mobileSession) {
          await client.query("ROLLBACK");
          return { currentToken, newToken: null };
        }
        expiresAt = mobileSession.expires_at;
      }

      const newToken = await this.create({
        userId: currentToken.user_id,
        tokenHash: newTokenHash,
        familyId: currentToken.family_id,
        sessionId: currentToken.session_id,
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
        mobileSession,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async revokeByHash(tokenHash, reason = "revoked") {
    const token = await this.findByHash(tokenHash);
    if (token?.session_id) {
      const revoked = await this.revokeFamily(token.family_id, reason);
      return revoked.find((row) => row.id === token.id) || token;
    }
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
    return this.revokeMatching("family_id", familyId, reason);
  }

  static async revokeMatching(column, value, reason) {
    if (!["family_id", "user_id"].includes(column)) throw new Error("Invalid revocation scope.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sessions = await client.query(`UPDATE auth_mobile_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
        revoked_reason = COALESCE(revoked_reason, $2) WHERE ${column} = $1 RETURNING id`, [value, reason]);
      const { rows } = await client.query(
      `
        UPDATE auth_refresh_tokens
        SET
          revoked_at = COALESCE(revoked_at, NOW()),
          revoked_reason = COALESCE(revoked_reason, $2)
        WHERE ${column} = $1
          AND revoked_at IS NULL
        RETURNING *
      `,
      [value, reason]
    );

      await client.query("COMMIT");
      notifyRevoked(sessions.rows.map((row) => row.id));
      return rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  static async revokeAllForUser(userId, reason = "user_logout_all") {
    return this.revokeMatching("user_id", userId, reason);
  }
}

module.exports = RefreshTokenModel;
