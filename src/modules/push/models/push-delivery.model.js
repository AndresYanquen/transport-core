const { pool } = require("../../../config/database");
const { ACTIVE_DEVICE } = require("./push-device.model");
const { env } = require("../../../config");

async function enqueue(userIds, notification, deviceId = null) {
  const { rowCount } = await pool.query(`INSERT INTO push_deliveries
      (event_id, user_id, device_id, registration_version, payload, expires_at, available_at)
    SELECT $1, d.user_id, d.id, d.registration_version, $3::jsonb, $4,
      clock_timestamp() + CASE WHEN $3::jsonb->>'type'='ride.invite'
        AND NOT (d.app_visibility='background' AND COALESCE(d.visibility_valid_until>clock_timestamp(),false))
        THEN $6 ELSE 0 END * INTERVAL '1 millisecond'
    FROM user_push_devices d JOIN users u ON u.id=d.user_id
    WHERE d.user_id=ANY($2::uuid[]) AND ($5::uuid IS NULL OR d.id=$5) AND ${ACTIVE_DEVICE}
    ON CONFLICT (event_id, user_id, device_id) DO NOTHING`,
  [notification.eventId, userIds, JSON.stringify(notification), notification.expiresAt, deviceId, env.push.invitationAckWaitMs]);
  return rowCount;
}
async function deviceOwner(deviceId) {
  const { rows } = await pool.query("SELECT user_id FROM user_push_devices WHERE id=$1", [deviceId]);
  return rows[0]?.user_id;
}
async function claim(limit, maxAttempts) {
  const { rows } = await pool.query(`WITH candidates AS (
      SELECT id FROM push_deliveries WHERE
        (status='pending' AND available_at<=clock_timestamp())
        OR (status='processing' AND lease_until<=clock_timestamp())
      ORDER BY available_at, id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE push_deliveries p SET
      status=CASE WHEN p.presented_at IS NOT NULL THEN 'suppressed'
        WHEN p.expires_at<=clock_timestamp() THEN 'discarded'
        WHEN p.attempts >= $2 THEN 'failed' ELSE 'processing' END,
      attempts=p.attempts+1, lease_id=gen_random_uuid(), dispatch_started_at=NULL,
      lease_until=clock_timestamp()+INTERVAL '5 minutes', updated_at=clock_timestamp()
    FROM candidates c WHERE p.id=c.id RETURNING p.*`, [limit, maxAttempts]);
  return rows.filter((row) => row.status === "processing");
}
async function eligibleDevice(job) {
  const { rows } = await pool.query(`SELECT d.id, d.fcm_token, d.platform FROM user_push_devices d
    JOIN users u ON u.id=d.user_id WHERE d.id=$1 AND d.user_id=$2 AND d.registration_version=$3
    AND ${ACTIVE_DEVICE}`, [job.device_id, job.user_id, job.registration_version]);
  return rows[0];
}
async function resourceIsCurrent(job) {
  const p = job.payload;
  if (p.type === "message.important") return true; // Trusted internal callers only.
  if (p.type === "driver.panic") {
    const result = await pool.query(`SELECT 1 FROM driver_notifications n JOIN users u ON u.id=$2
      WHERE n.id=$1 AND n.type='panic' AND n.status='unread' AND u.role IN ('operator','admin')`,
    [p.notificationId, job.user_id]);
    return result.rowCount > 0;
  }
  if (p.type === "ride.invite") {
    const result = await pool.query(`SELECT 1 FROM ride_driver_invites i
      JOIN rides r ON r.id=i.ride_id JOIN drivers d ON d.user_id=i.driver_id
      WHERE i.id=$1 AND i.driver_id=$2 AND i.status='pending' AND date_trunc('milliseconds', i.invited_at)=$3::timestamptz
        AND r.status='pending_driver' AND r.driver_id IS NULL
        AND d.status='online' AND d.approval_status='approved'
        AND d.last_seen_at>=clock_timestamp()-$4*INTERVAL '1 second'
        AND EXISTS (SELECT 1 FROM driver_service_types dst JOIN service_types st ON st.code=dst.service_type_code
          WHERE dst.driver_id=d.user_id AND dst.service_type_code=r.service_type AND dst.is_active AND st.is_active)
        AND NOT EXISTS (SELECT 1 FROM rides other WHERE other.driver_id=d.user_id
          AND other.status IN ('driver_assigned','driver_en_route','driver_arrived','in_progress'))`,
    [p.inviteId, job.user_id, p.invitedAt, env.driverPresence.staleAfterSeconds]);
    return result.rowCount > 0;
  }
  const result = await pool.query(`SELECT 1 FROM rides r JOIN ride_events e ON e.ride_id=r.id
    WHERE r.id=$1 AND r.status=$2 AND e.id=$3 AND e.status=$2
      AND (r.client_id=$4 OR r.driver_id=$4)
      AND NOT EXISTS (SELECT 1 FROM ride_events newer WHERE newer.ride_id=r.id
        AND newer.status<>e.status AND newer.occurred_at>e.occurred_at)`,
  [p.rideId, p.status, p.sourceEventId, job.user_id]);
  return result.rowCount > 0;
}
async function finish(job, { status, code = null, messageId = null, delaySeconds = 0 }) {
  await pool.query(`UPDATE push_deliveries SET status=CASE WHEN $3='pending' AND presented_at IS NOT NULL THEN 'suppressed' ELSE $3 END,
    last_error=$4, provider_message_id=$5,
    available_at=clock_timestamp()+$6*INTERVAL '1 second', lease_until=NULL, lease_id=NULL,
    updated_at=clock_timestamp() WHERE id=$1 AND lease_id=$2 AND status='processing'`,
  [job.id, job.lease_id, status, code, messageId, delaySeconds]);
}
async function cleanup(retentionDays) {
  await pool.query(`DELETE FROM push_deliveries WHERE id IN (SELECT id FROM push_deliveries
    WHERE status IN ('accepted','discarded','failed','suppressed') AND updated_at < clock_timestamp()-$1*INTERVAL '1 day'
    LIMIT 1000)`, [retentionDays]);
}
// The row lock is the linearization point between a presentation ACK and dispatch.
async function reserveForSend(jobs) {
  if (!jobs.length) return [];
  const claims = jobs.map((job) => ({ id: job.id, lease_id: job.lease_id }));
  const { rows } = await pool.query(`UPDATE push_deliveries p SET dispatch_started_at=clock_timestamp(),
    updated_at=clock_timestamp() FROM jsonb_to_recordset($1::jsonb) AS claims(id uuid, lease_id uuid),
    user_push_devices d JOIN users u ON u.id=d.user_id
    WHERE p.id=claims.id AND p.lease_id=claims.lease_id AND p.status='processing'
      AND p.lease_until>clock_timestamp() AND p.presented_at IS NULL AND p.dispatch_started_at IS NULL
      AND p.expires_at>clock_timestamp() AND p.device_id=d.id AND p.user_id=d.user_id
      AND p.registration_version=d.registration_version AND ${ACTIVE_DEVICE}
    RETURNING p.id, d.fcm_token`, [JSON.stringify(claims)]);
  return rows;
}
async function acknowledgePresentation({ userId, sessionId, installationId, eventId }) {
  const { rows } = await pool.query(`UPDATE push_deliveries p SET
    presented_at=COALESCE(p.presented_at,clock_timestamp()),
    status=CASE WHEN p.status='pending' OR (p.status='processing' AND p.dispatch_started_at IS NULL)
      THEN 'suppressed' ELSE p.status END, updated_at=clock_timestamp()
    FROM user_push_devices d JOIN users u ON u.id=d.user_id
    WHERE p.event_id=$1 AND p.user_id=$2 AND p.device_id=d.id AND d.user_id=$2
      AND d.session_id=$3 AND d.installation_id=$4 AND p.registration_version=d.registration_version
      AND ${ACTIVE_DEVICE} AND p.payload->>'type'='ride.invite' AND p.expires_at>clock_timestamp()
      AND p.status IN ('pending','processing','accepted','suppressed')
      AND EXISTS (SELECT 1 FROM ride_driver_invites i JOIN rides r ON r.id=i.ride_id
        WHERE i.id=(p.payload->>'inviteId')::uuid AND i.driver_id=$2 AND i.status='pending'
          AND date_trunc('milliseconds',i.invited_at)=(p.payload->>'invitedAt')::timestamptz
          AND r.status='pending_driver' AND r.driver_id IS NULL)
    RETURNING p.status, p.presented_at AS "presentedAt"`, [eventId, userId, sessionId, installationId]);
  if (!rows[0]) return { recorded: false, suppressed: false, reason: "not_pending_for_installation" };
  return { recorded: true, suppressed: rows[0].status === "suppressed", presentedAt: rows[0].presentedAt,
    ...(rows[0].status === "suppressed" ? {} : { reason: "dispatch_already_started" }) };
}
module.exports = { enqueue, deviceOwner, claim, eligibleDevice, resourceIsCurrent, finish, cleanup,
  reserveForSend, acknowledgePresentation };
