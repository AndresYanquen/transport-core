function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value) { if (!uuidPattern.test(String(value || ''))) fail('Identificador inválido.'); return value; }
function section(value) { if (!['promotions', 'safety'].includes(value)) fail('Sección inválida.'); return value; }
function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`Se requiere un entero entre ${min} y ${max}.`);
  return value;
}
function text(value, max, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') fail('Texto inválido.');
  const result = (value || '').trim();
  if (result.length > max || (required && !result)) fail(`Texto requerido o mayor de ${max} caracteres.`);
  return result;
}
function date(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) fail('La fecha debe incluir zona horaria.');
  return new Date(value).toISOString();
}
function content(input = {}, { publishing = false, sectionKey } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Contenido inválido.');
  const result = {
    title: text(input.title, 120, true), summary: text(input.summary, 500),
    altText: text(input.altText, 250), buttonLabel: text(input.buttonLabel, 40),
    assetId: input.assetId ? uuid(input.assetId) : null,
    sortOrder: integer(input.sortOrder ?? 0, 0, 10000),
    startsAt: date(input.startsAt), endsAt: date(input.endsAt),
  };
  if (result.startsAt && result.endsAt && result.startsAt >= result.endsAt) fail('El fin debe ser posterior al inicio.');
  const action = input.action || { type: 'detail' };
  if (!['detail', 'request_ride', 'external'].includes(action.type)) fail('Acción inválida.');
  result.action = { type: action.type };
  if (action.type === 'external') {
    let url; try { url = new URL(action.url); } catch { fail('Enlace HTTPS inválido.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) fail('Enlace HTTPS inválido.');
    result.action.url = url.href;
  }
  if (sectionKey === 'safety' && action.type !== 'detail') fail('Seguridad debe abrir su pantalla de detalle.');
  if (!Array.isArray(input.blocks ?? [] ) || (input.blocks || []).length > 40) fail('Máximo 40 bloques.');
  result.blocks = (input.blocks || []).map((block) => {
    if (!block || !['heading', 'paragraph', 'bullet'].includes(block.type)) fail('Bloque inválido.');
    return { type: block.type, text: text(block.text, 3000, true) };
  });
  if (publishing) {
    if (sectionKey === 'promotions' && !result.assetId) fail('La promoción requiere una imagen.');
    if (result.assetId && !result.altText) fail('Agrega el texto alternativo de la imagen.');
    if (!result.buttonLabel) fail('Agrega el texto del botón.');
    if (sectionKey === 'safety' && !result.summary) fail('Agrega el resumen de seguridad.');
    if (result.action.type === 'detail' && !result.blocks.length) fail('Agrega contenido para la pantalla de detalle.');
    if (result.endsAt && Date.parse(result.endsAt) <= Date.now()) fail('La vigencia ya terminó.');
  }
  return result;
}
module.exports = { fail, uuid, section, integer, content };
