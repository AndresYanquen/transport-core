const { pool } = require("../../../config/database");
async function transaction(work) {
  const db = await pool.connect();
  try { await db.query("BEGIN"); const result = await work(db); await db.query("COMMIT"); return result; }
  catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
async function audit(db, actorId, userId, action, fields) {
  await db.query("INSERT INTO user_change_audit (actor_id, user_id, action, fields) VALUES ($1, $2, $3, $4::jsonb)", [actorId, userId, action, JSON.stringify(fields)]);
}
async function updateFields(db, table, id, fields) {
  // Table and column names originate exclusively in service-owned maps.
  const entries = Object.entries(fields);
  if (!entries.length) return;
  const assignments = entries.map(([column], i) => `${column} = $${i + 2}`);
  const result = await db.query(`UPDATE ${table} SET ${assignments.join(", ")}, updated_at = clock_timestamp() WHERE ${table === "users" ? "id" : "user_id"} = $1 RETURNING *`, [id, ...entries.map(([, value]) => value)]);
  if (!result.rows.length) throw Object.assign(new Error("Profile not found."), { status: 404 });
}
module.exports = { transaction, audit, updateFields };
