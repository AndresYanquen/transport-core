const { pool } = require("../../../config/database");
const crypto = require("node:crypto");
const { env } = require("../../../config");

const ACTIVE_DEVICE = `d.enabled AND d.fcm_token IS NOT NULL AND u.status = 'active'
  AND u.deleted_at IS NULL AND d.security_version = u.security_version
  AND ((d.session_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth_mobile_sessions s
    WHERE s.id = d.session_id AND s.user_id = d.user_id AND s.installation_id = d.installation_id
      AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
      AND s.absolute_expires_at > clock_timestamp()))
    OR (d.session_id IS NULL AND u.role IN ('admin', 'operator') AND d.authorized_until > clock_timestamp()))`;
const PUBLIC_FIELDS = `id, platform, installation_id AS "installationId", enabled,
  last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt",
  app_visibility AS "appVisibility", visibility_reported_at AS "visibilityReportedAt",
  visibility_valid_until AS "visibilityValidUntil"`;

async function register({ userId, token, platform, installationId, sessionId, securityVersion, authorizedUntil }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Low-frequency registration only; a global xact lock also handles cross-account token transfers.
    await client.query("SELECT pg_advisory_xact_lock(18472309)");
    if (sessionId) {
      const session = await client.query(`SELECT id FROM auth_mobile_sessions WHERE id=$1 AND user_id=$2
        AND installation_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp()
        AND absolute_expires_at>clock_timestamp() FOR UPDATE`, [sessionId, userId, installationId]);
      if (!session.rowCount) throw Object.assign(new Error("Active installation session required."), { status: 401 });
    }
    // Clear any previous owner before upserting this user's installation. No token is ever returned.
    await client.query(`UPDATE user_push_devices SET enabled=false, fcm_token=NULL,
      registration_version=gen_random_uuid(), updated_at=clock_timestamp()
      WHERE fcm_token=$1 AND (user_id<>$2 OR installation_id<>$3)`, [token, userId, installationId]);
    const { rows } = await client.query(`INSERT INTO user_push_devices
      (user_id, fcm_token, platform, installation_id, session_id, security_version, authorized_until)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (user_id, installation_id) DO UPDATE SET
        registration_version=CASE WHEN user_push_devices.fcm_token IS DISTINCT FROM EXCLUDED.fcm_token
          OR user_push_devices.session_id IS DISTINCT FROM EXCLUDED.session_id
          OR user_push_devices.security_version<>EXCLUDED.security_version OR NOT user_push_devices.enabled
          THEN gen_random_uuid() ELSE user_push_devices.registration_version END,
        app_visibility=CASE WHEN user_push_devices.fcm_token IS DISTINCT FROM EXCLUDED.fcm_token
          OR user_push_devices.session_id IS DISTINCT FROM EXCLUDED.session_id
          OR user_push_devices.security_version<>EXCLUDED.security_version OR NOT user_push_devices.enabled
          THEN 'unknown' ELSE user_push_devices.app_visibility END,
        visibility_reported_at=CASE WHEN user_push_devices.fcm_token IS DISTINCT FROM EXCLUDED.fcm_token
          OR user_push_devices.session_id IS DISTINCT FROM EXCLUDED.session_id
          OR user_push_devices.security_version<>EXCLUDED.security_version OR NOT user_push_devices.enabled
          THEN NULL ELSE user_push_devices.visibility_reported_at END,
        visibility_valid_until=CASE WHEN user_push_devices.fcm_token IS DISTINCT FROM EXCLUDED.fcm_token
          OR user_push_devices.session_id IS DISTINCT FROM EXCLUDED.session_id
          OR user_push_devices.security_version<>EXCLUDED.security_version OR NOT user_push_devices.enabled
          THEN NULL ELSE user_push_devices.visibility_valid_until END,
        fcm_token=EXCLUDED.fcm_token, platform=EXCLUDED.platform, session_id=EXCLUDED.session_id,
        security_version=EXCLUDED.security_version, authorized_until=EXCLUDED.authorized_until,
        enabled=true, last_seen_at=clock_timestamp(), updated_at=clock_timestamp()
      RETURNING ${PUBLIC_FIELDS}`, [userId, token, platform, installationId, sessionId, securityVersion, authorizedUntil]);
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    // Do not expose SQL errors (e.g. unique violations containing a token).
    if (error.status) throw error;
    throw Object.assign(new Error("Could not register push device."), { status: 503 });
  } finally { client.release(); }
}
async function unregister({ userId, sessionId, installationId, token }) {
  await pool.query(`UPDATE user_push_devices SET enabled=false, fcm_token=NULL,
    registration_version=gen_random_uuid(), updated_at=clock_timestamp()
    WHERE user_id=$1 AND session_id IS NOT DISTINCT FROM $2::uuid
      AND ($3::uuid IS NULL OR installation_id=$3) AND ($4::text IS NULL OR fcm_token=$4)`,
  [userId, sessionId, installationId || null, token || null]);
}
async function list(userId) {
  const { rows } = await pool.query(`SELECT ${PUBLIC_FIELDS} FROM user_push_devices WHERE user_id=$1 ORDER BY created_at DESC`, [userId]);
  return rows;
}
async function disableInvalidToken(id, registrationVersion) {
  await pool.query(`UPDATE user_push_devices SET enabled=false, fcm_token=NULL,
    registration_version=$3, updated_at=clock_timestamp() WHERE id=$1 AND registration_version=$2`,
  [id, registrationVersion, crypto.randomUUID()]);
}
async function disableRevoked() {
  await pool.query(`UPDATE user_push_devices d SET enabled=false, fcm_token=NULL,
    registration_version=gen_random_uuid(), updated_at=clock_timestamp() FROM users u
    WHERE u.id=d.user_id AND d.enabled AND NOT (${ACTIVE_DEVICE})`);
}
async function reportVisibility({ userId, sessionId, installationId, visibility }) {
  const { rows } = await pool.query(`UPDATE user_push_devices d SET app_visibility=$4,
    visibility_reported_at=clock_timestamp(), visibility_valid_until=clock_timestamp()+$5*INTERVAL '1 second',
    updated_at=clock_timestamp() FROM users u WHERE u.id=d.user_id AND d.user_id=$1
    AND d.session_id=$2 AND d.installation_id=$3 AND ${ACTIVE_DEVICE}
    RETURNING d.app_visibility AS "visibility", d.visibility_reported_at AS "reportedAt",
      d.visibility_valid_until AS "validUntil"`, [userId, sessionId, installationId, visibility, env.push.visibilityTtlSeconds]);
  if (!rows[0]) throw Object.assign(new Error("Register an active push device for this installation first."), { status: 404 });
  return rows[0];
}
module.exports = { register, unregister, list, disableInvalidToken, disableRevoked, reportVisibility, ACTIVE_DEVICE };
