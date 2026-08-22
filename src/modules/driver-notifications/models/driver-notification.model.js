const { pool, query } = require("../../../config/database");

function executor(client) {
  return client || { query };
}

function mapNotification(row) {
  if (!row) return null;

  return {
    id: row.id,
    driverId: row.driver_id,
    rideId: row.ride_id,
    type: row.type,
    priority: row.priority,
    status: row.status,
    title: row.title,
    message: row.message,
    metadata: row.metadata || {},
    acknowledgedByUserId: row.acknowledged_by_user_id,
    acknowledgedAt: row.acknowledged_at,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNotificationWithDriver(row) {
  const notification = mapNotification(row);
  if (!notification) return null;

  return {
    ...notification,
    driver: {
      firstName: row.driver_first_name,
      lastName: row.driver_last_name,
      email: row.driver_email,
      phoneNumber: row.driver_phone_number,
    },
  };
}

async function create({
  driverId,
  rideId = null,
  type,
  priority,
  status,
  title,
  message,
  metadata = {},
}, client) {
  const { rows } = await executor(client).query(
    `
      INSERT INTO driver_notifications (
        driver_id,
        ride_id,
        type,
        priority,
        status,
        title,
        message,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      RETURNING *
    `,
    [
      driverId,
      rideId,
      type,
      priority,
      status,
      title,
      message,
      JSON.stringify(metadata || {}),
    ]
  );

  return mapNotification(rows[0]);
}

async function findActivePanicByDriver(driverId, { withinSeconds = 300, client } = {}) {
  const { rows } = await executor(client).query(
    `
      SELECT *
      FROM driver_notifications
      WHERE driver_id = $1
        AND type = 'panic'
        AND status IN ('unread', 'acknowledged')
        AND created_at >= NOW() - ($2::double precision * INTERVAL '1 second')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [driverId, withinSeconds]
  );

  return mapNotification(rows[0]);
}

async function list({ status = "unread", type = null, limit = 100 } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const params = [status, normalizedLimit];
  let typeClause = "";

  if (type) {
    params.push(type);
    typeClause = `AND dn.type = $${params.length}`;
  }

  const { rows } = await query(
    `
      SELECT
        dn.*,
        u.first_name AS driver_first_name,
        u.last_name AS driver_last_name,
        u.email AS driver_email,
        u.phone_number AS driver_phone_number
      FROM driver_notifications dn
      JOIN users u ON u.id = dn.driver_id
      WHERE dn.status = $1
      ${typeClause}
      ORDER BY
        CASE dn.priority WHEN 'emergency' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
        dn.created_at ASC
      LIMIT $2
    `,
    params
  );

  return rows.map(mapNotificationWithDriver);
}

async function getById(id, { forUpdate = false, client } = {}) {
  const { rows } = await executor(client).query(
    `
      SELECT *
      FROM driver_notifications
      WHERE id = $1
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [id]
  );

  return mapNotification(rows[0]);
}

async function update(id, fields, client) {
  const names = Object.keys(fields);
  const values = Object.values(fields);
  const sets = names.map((name, index) => `${name} = $${index + 2}`);
  const { rows } = await executor(client).query(
    `
      UPDATE driver_notifications
      SET ${sets.join(", ")}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, ...values]
  );

  return mapNotification(rows[0]);
}

module.exports = {
  pool,
  create,
  findActivePanicByDriver,
  list,
  getById,
  update,
};
