const { pool, query } = require('../../config/database');
const V = require('./validation');
const storage = require('./storage.service');
async function transaction(work) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await work(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
async function assetExists(db, sectionKey, data) {
  if (!data.assetId) return;
  const { rows } = await db.query('SELECT id FROM home_content_assets WHERE id=$1 AND section_key=$2 FOR SHARE', [data.assetId, sectionKey]);
  if (!rows.length) V.fail('La imagen no existe o pertenece a otra sección.');
}
async function listAdmin() {
  const [sections, items, assets] = await Promise.all([
    query('SELECT * FROM home_sections ORDER BY sort_order, key'),
    query('SELECT * FROM home_content_items ORDER BY updated_at DESC'),
    query('SELECT id,section_key,url,mime_type,size_bytes,width,height,created_at FROM home_content_assets ORDER BY created_at DESC'),
  ]);
  return { sections: sections.rows, items: items.rows, assets: assets.rows };
}
async function saveItem(userId, id, body) {
  if (id) V.uuid(id);
  const sectionKey = V.section(body.sectionKey);
  const draft = V.content(body.content, { sectionKey });
  if (id) V.integer(body.revision, 1, 2147483647);
  return transaction(async (db) => {
    await assetExists(db, sectionKey, draft);
    const result = id
      ? await db.query(`UPDATE home_content_items SET draft=$1,updated_by=$2,updated_at=NOW(),revision=revision+1
          WHERE id=$3 AND revision=$4 AND section_key=$5 RETURNING *`, [draft,userId,id,body.revision,sectionKey])
      : await db.query(`INSERT INTO home_content_items(section_key,draft,created_by,updated_by) VALUES($1,$2,$3,$3) RETURNING *`, [sectionKey,draft,userId]);
    if (!result.rows.length) V.fail('El contenido cambió o ya no existe. Recarga antes de guardar.', 409);
    return result.rows[0];
  });
}
async function changeStatus(userId, id, body, publish) {
  V.uuid(id); V.integer(body.revision, 1, 2147483647);
  return transaction(async (db) => {
    // The section lock serializes safety publication and keeps a single published card.
    const found = await db.query('SELECT section_key FROM home_content_items WHERE id=$1', [id]);
    if (!found.rows.length) V.fail('Contenido no encontrado.', 404);
    await db.query('SELECT key FROM home_sections WHERE key=$1 FOR UPDATE', [found.rows[0].section_key]);
    const { rows } = await db.query('SELECT * FROM home_content_items WHERE id=$1 FOR UPDATE', [id]);
    const item = rows[0];
    if (item.revision !== body.revision) V.fail('El contenido cambió. Recarga antes de continuar.', 409);
    if (publish) {
      const data = V.content(item.draft, { publishing: true, sectionKey: item.section_key });
      await assetExists(db, item.section_key, data);
      if (item.section_key === 'safety') {
        const other = await db.query("SELECT id FROM home_content_items WHERE section_key='safety' AND status='published' AND id<>$1", [id]);
        if (other.rows.length) V.fail('Archiva la tarjeta de Seguridad publicada antes de publicar otra.', 409);
      }
      return (await db.query(`UPDATE home_content_items SET published=$1,status='published',published_by=$2,published_at=NOW(),updated_by=$2,updated_at=NOW(),revision=revision+1 WHERE id=$3 RETURNING *`, [data,userId,id])).rows[0];
    }
    return (await db.query("UPDATE home_content_items SET status='archived',published=NULL,updated_by=$1,updated_at=NOW(),revision=revision+1 WHERE id=$2 RETURNING *", [userId,id])).rows[0];
  });
}
async function updateSection(userId, key, body) {
  V.section(key); V.integer(body.revision, 1, 2147483647);
  if (typeof body.enabled !== 'boolean') V.fail('enabled debe ser booleano.');
  V.integer(body.sortOrder, 0, 10000); V.integer(body.carouselIntervalSeconds, 3, 30);
  const { rows } = await query(`UPDATE home_sections SET enabled=$1,sort_order=$2,carousel_interval_seconds=$3,updated_by=$4,updated_at=NOW(),revision=revision+1 WHERE key=$5 AND revision=$6 RETURNING *`, [body.enabled,body.sortOrder,body.carouselIntervalSeconds,userId,key,body.revision]);
  if (!rows.length) V.fail('La sección cambió. Recarga antes de guardar.', 409);
  return rows[0];
}
async function getHomeContent(id) {
  if (id) V.uuid(id);
  // One database statement gives a consistent snapshot of enabled sections and published items.
  const { rows } = await query(`SELECT s.key,s.sort_order,s.carousel_interval_seconds,i.id,i.published,i.published_at,
    a.id AS asset_id,a.url,a.width,a.height
    FROM home_sections s JOIN home_content_items i ON i.section_key=s.key
    LEFT JOIN home_content_assets a ON a.id::text=i.published->>'assetId'
    WHERE s.enabled AND i.status='published' AND i.published IS NOT NULL
      AND (i.published->>'startsAt' IS NULL OR (i.published->>'startsAt')::timestamptz <= NOW())
      AND (i.published->>'endsAt' IS NULL OR (i.published->>'endsAt')::timestamptz > NOW())
      AND ($1::uuid IS NULL OR i.id=$1)
    ORDER BY s.sort_order,s.key,(i.published->>'sortOrder')::integer,i.id`, [id || null]);
  const sections = [];
  for (const row of rows) {
    let group = sections.find((s) => s.key === row.key);
    if (!group) { group = { key: row.key, sortOrder: row.sort_order, carouselIntervalSeconds: row.carousel_interval_seconds, items: [] }; sections.push(group); }
    const { assetId, ...data } = row.published;
    group.items.push({ id: row.id, ...data, action: { ...data.action, ...(data.action.type === 'detail' ? { itemId: row.id } : {}) }, image: row.asset_id ? { url: row.url, width: row.width, height: row.height, altText: data.altText } : null, publishedAt: row.published_at });
  }
  if (id) {
    if (!sections.length) V.fail('Contenido no disponible.', 404);
    return { item: sections[0].items[0] };
  }
  return { schemaVersion: 1, audience: 'client', sections };
}
async function deleteAsset(id) {
  V.uuid(id);
  return transaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM home_content_assets WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) V.fail('Imagen no encontrada.', 404);
    const refs = await db.query("SELECT id FROM home_content_items WHERE draft->>'assetId'=$1 OR published->>'assetId'=$1 LIMIT 1", [id]);
    if (refs.rows.length) V.fail('La imagen está en uso por un borrador o publicación.', 409);
    try { await storage.deleteObject(rows[0].object_key); } catch { V.fail('No se pudo eliminar la imagen de R2. Intenta nuevamente.', 502); }
    await db.query('DELETE FROM home_content_assets WHERE id=$1', [id]);
  });
}
module.exports = { listAdmin, saveItem, changeStatus, updateSection, getHomeContent, deleteAsset };
