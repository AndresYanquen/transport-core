const { query } = require("../../../config/database");

function mapEvent(row) {
  if (!row) return null;

  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

async function reserveIdempotencyKey({ idempotencyKey, eventType }) {
  const { rows } = await query(
    `
      INSERT INTO whatsapp_webhook_events (
        idempotency_key,
        event_type
      )
      VALUES ($1, $2)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *
    `,
    [idempotencyKey, eventType]
  );

  return {
    reserved: Boolean(rows[0]),
    event: mapEvent(rows[0]),
  };
}

async function markProcessed(idempotencyKey) {
  const { rows } = await query(
    `
      UPDATE whatsapp_webhook_events
      SET processed_at = NOW()
      WHERE idempotency_key = $1
      RETURNING *
    `,
    [idempotencyKey]
  );

  return mapEvent(rows[0]);
}

async function releaseReservation(idempotencyKey) {
  await query(
    `
      DELETE FROM whatsapp_webhook_events
      WHERE idempotency_key = $1
        AND processed_at IS NULL
    `,
    [idempotencyKey]
  );
}

module.exports = {
  reserveIdempotencyKey,
  markProcessed,
  releaseReservation,
};
