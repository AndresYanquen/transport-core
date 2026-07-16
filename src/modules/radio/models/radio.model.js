const { pool, query } = require("../../../config/database");

function executor(client) {
  return client || { query };
}

function mapRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    driverId: row.driver_id,
    rideId: row.ride_id,
    handledByOperatorId: row.handled_by_operator_id,
    priority: row.priority,
    reason: row.reason,
    status: row.status,
    resolutionReason: row.resolution_reason,
    expiresAt: row.expires_at,
    handledAt: row.handled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    operatorId: row.operator_id,
    driverId: row.driver_id,
    rideId: row.ride_id,
    status: row.status,
    speaker: row.speaker,
    operatorMuted: row.operator_muted,
    driverMuted: row.driver_muted,
    startedAt: row.started_at,
    connectedAt: row.connected_at,
    endedAt: row.ended_at,
    lastActivityAt: row.last_activity_at,
    endReason: row.end_reason,
    failureReason: row.failure_reason,
  };
}

async function findPendingRequestByDriver(driverId, client) {
  const { rows } = await executor(client).query(
    `SELECT * FROM radio_requests WHERE driver_id=$1 AND status='pending' LIMIT 1`,
    [driverId]
  );
  return mapRequest(rows[0]);
}

async function createRequest({ driverId, rideId, priority, reason, expiresAt }, client) {
  const { rows } = await executor(client).query(
    `INSERT INTO radio_requests(driver_id,ride_id,priority,reason,expires_at)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [driverId, rideId || null, priority, reason, expiresAt]
  );
  return mapRequest(rows[0]);
}

async function getRequest(id, { forUpdate = false, client } = {}) {
  const { rows } = await executor(client).query(
    `SELECT * FROM radio_requests WHERE id=$1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [id]
  );
  return mapRequest(rows[0]);
}

async function listRequests({ status = "pending", limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT rr.*, u.first_name, u.last_name, u.email
     FROM radio_requests rr JOIN users u ON u.id=rr.driver_id
     WHERE rr.status=$1
     ORDER BY CASE rr.priority WHEN 'emergency' THEN 1 WHEN 'active_ride' THEN 2 ELSE 3 END,
              rr.created_at ASC LIMIT $2`,
    [status, limit]
  );
  return rows.map((row) => ({
    ...mapRequest(row),
    driver: { firstName: row.first_name, lastName: row.last_name, email: row.email },
  }));
}

async function updateRequest(id, fields, client) {
  const names = Object.keys(fields);
  const values = Object.values(fields);
  const sets = names.map((name, i) => `${name}=$${i + 2}`);
  const { rows } = await executor(client).query(
    `UPDATE radio_requests SET ${sets.join(",")},updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, ...values]
  );
  return mapRequest(rows[0]);
}

async function createSession({ requestId, operatorId, driverId, rideId }, client) {
  const { rows } = await executor(client).query(
    `INSERT INTO radio_sessions(request_id,operator_id,driver_id,ride_id)
     VALUES($1,$2,$3,$4) RETURNING *`,
    [requestId || null, operatorId, driverId, rideId || null]
  );
  return mapSession(rows[0]);
}

async function getSession(id, { forUpdate = false, client } = {}) {
  const { rows } = await executor(client).query(
    `SELECT * FROM radio_sessions WHERE id=$1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [id]
  );
  return mapSession(rows[0]);
}

async function updateSession(id, fields, client) {
  const names = Object.keys(fields);
  const values = Object.values(fields);
  const sets = names.map((name, i) => `${name}=$${i + 2}`);
  const { rows } = await executor(client).query(
    `UPDATE radio_sessions SET ${sets.join(",")},updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, ...values]
  );
  return mapSession(rows[0]);
}

async function insertEvent({ sessionId, actorId, actorRole, eventType, metadata = {} }, client) {
  await executor(client).query(
    `INSERT INTO radio_session_events(session_id,actor_id,actor_role,event_type,metadata)
     VALUES($1,$2,$3,$4,$5::jsonb)`,
    [sessionId, actorId || null, actorRole || null, eventType, JSON.stringify(metadata)]
  );
}

async function expireRequests() {
  const { rows } = await query(
    `UPDATE radio_requests SET status='expired',updated_at=NOW()
     WHERE status='pending' AND expires_at<=NOW() RETURNING *`
  );
  return rows.map(mapRequest);
}

async function expireSessions({ connectSeconds, idleSeconds }) {
  const { rows } = await query(
    `UPDATE radio_sessions SET
       status=CASE WHEN status='connecting' THEN 'failed' ELSE 'ended' END,
       ended_at=NOW(),
       end_reason=CASE WHEN status='connecting' THEN NULL ELSE 'idle_timeout' END,
       failure_reason=CASE WHEN status='connecting' THEN 'connection_timeout' ELSE NULL END,
       updated_at=NOW()
     WHERE (status='connecting' AND started_at<NOW()-($1::double precision*INTERVAL '1 second'))
        OR (status NOT IN ('connecting','ended','failed')
            AND last_activity_at<NOW()-($2::double precision*INTERVAL '1 second'))
     RETURNING *`,
    [connectSeconds, idleSeconds]
  );
  return rows.map(mapSession);
}

module.exports = {
  pool,
  findPendingRequestByDriver,
  createRequest,
  getRequest,
  listRequests,
  updateRequest,
  createSession,
  getSession,
  updateSession,
  insertEvent,
  expireRequests,
  expireSessions,
};
