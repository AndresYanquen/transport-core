const { query } = require("../../../config/database");

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

function mapSession(row) {
  if (!row) return null;

  return {
    id: row.id,
    phone: row.phone,
    userId: row.user_id,
    state: row.state,
    context: parseJson(row.context),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findByPhone(phone) {
  const { rows } = await query(
    `
      SELECT *
      FROM whatsapp_sessions
      WHERE phone = $1
      LIMIT 1
    `,
    [phone]
  );

  return mapSession(rows[0]);
}

async function upsertSession({ phone, userId, state, context, expiresAt }) {
  const { rows } = await query(
    `
      INSERT INTO whatsapp_sessions (
        phone,
        user_id,
        state,
        context,
        expires_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (phone)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        state = EXCLUDED.state,
        context = EXCLUDED.context,
        expires_at = EXCLUDED.expires_at
      RETURNING *
    `,
    [
      phone,
      userId ?? null,
      state,
      JSON.stringify(context ?? {}),
      expiresAt,
    ]
  );

  return mapSession(rows[0]);
}

async function resetSession({ phone, userId, expiresAt }) {
  return upsertSession({
    phone,
    userId,
    state: "START",
    context: {},
    expiresAt,
  });
}

module.exports = {
  findByPhone,
  upsertSession,
  resetSession,
};
