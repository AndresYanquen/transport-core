const crypto = require("crypto");
const { pool } = require("../../../config/database");

class MobileSessionModel {
  static async create({ userId, installation, rememberMe, ttlSeconds, maxTtlSeconds }, client) {
    // Issued only inside the transaction that verifies and consumes an OTP.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`mobile:${userId}:${installation.deviceId}`]);
    const old = await client.query(`UPDATE auth_mobile_sessions SET revoked_at = clock_timestamp(),
      revoked_reason = 'installation_reauthenticated' WHERE user_id = $1 AND installation_id = $2
      AND revoked_at IS NULL RETURNING id`, [userId, installation.deviceId]);
    if (old.rows.length) {
      await client.query(`UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
        revoked_reason = COALESCE(revoked_reason, 'installation_reauthenticated')
        WHERE session_id = ANY($1::uuid[])`, [old.rows.map((row) => row.id)]);
    }
    const { rows } = await client.query(`INSERT INTO auth_mobile_sessions
      (user_id, installation_id, family_id, device_name, platform, app_version, os_version, remember_me,
        expires_at, absolute_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
        clock_timestamp() + $9 * INTERVAL '1 second', clock_timestamp() + $10 * INTERVAL '1 second') RETURNING *`,
    [userId, installation.deviceId, crypto.randomUUID(), installation.name, installation.platform,
      installation.appVersion, installation.osVersion, rememberMe, Math.min(ttlSeconds, maxTtlSeconds), maxTtlSeconds]);
    return { ...rows[0], replacedSessionIds: old.rows.map((row) => row.id) };
  }

  static async findActive(id, userId, client = null, lock = false) {
    const { rows } = await (client || pool).query(`SELECT * FROM auth_mobile_sessions
      WHERE id = $1 AND user_id = $2 ${lock ? "FOR UPDATE" : ""}`, [id, userId]);
    const row = rows[0];
    if (!row || row.revoked_at) return null;
    // Separate clock query executes after a potentially blocking row lock.
    const valid = await (client || pool).query(`SELECT revoked_at IS NULL AND expires_at > clock_timestamp()
      AND absolute_expires_at > clock_timestamp() AND EXISTS (SELECT 1 FROM users u
        WHERE u.id = auth_mobile_sessions.user_id AND u.status = 'active' AND u.deleted_at IS NULL)
      AS valid FROM auth_mobile_sessions WHERE id = $1`, [id]);
    return valid.rows[0]?.valid ? row : null;
  }

  static toPublic(row) {
    if (!row) return undefined;
    return { id: row.id, installationId: row.installation_id, deviceName: row.device_name,
      platform: row.platform, appVersion: row.app_version, osVersion: row.os_version,
      createdAt: row.created_at, lastUsedAt: row.last_used_at, expiresAt: row.expires_at,
      absoluteExpiresAt: row.absolute_expires_at, authMethod: row.auth_method };
  }
}

module.exports = MobileSessionModel;
