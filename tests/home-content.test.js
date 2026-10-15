const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/modules/home-content/validation');
const database = require('../src/config/database');
const storageConfig = require('../src/config/storage');
// Capture a controllable R2 client without opening external connections.
const originalR2 = storageConfig.getR2Client;
let send = async () => ({});
storageConfig.getR2Client = () => ({ send: (...args) => send(...args) });
const storage = require('../src/modules/home-content/storage.service');
storageConfig.getR2Client = originalR2;
const originalQuery = database.query;
let query = async () => ({ rows: [] });
database.query = (...args) => query(...args);
const service = require('../src/modules/home-content/home-content.service');
database.query = originalQuery;
const ID = 'c6f97644-52b4-4b94-8ed7-02bf4dff32ee';
const OTHER = 'd6f97644-52b4-4b94-8ed7-02bf4dff32ee';
const promotion = (changes = {}) => ({ title: 'Viaja con nosotros', summary: 'Conoce más', assetId: ID, altText: 'Taxi en la ciudad', buttonLabel: 'Descubre más', sortOrder: 10, action: { type: 'detail' }, blocks: [{ type: 'paragraph', text: 'Contenido publicado' }], ...changes });
const badRequest = (e) => e.status === 400;

function mockTransaction(t, responder) {
  const statements = [];
  t.mock.method(database.pool, 'connect', async () => ({
    query: async (sql, params) => { statements.push({ sql, params }); return responder(sql, params); },
    release() {},
  }));
  return statements;
}

test('publication requires a banner image and detail content; safety can use its default icon', () => {
  assert.throws(() => V.content(promotion({ assetId: null }), { publishing: true, sectionKey: 'promotions' }), badRequest);
  assert.throws(() => V.content(promotion({ blocks: [] }), { publishing: true, sectionKey: 'promotions' }), badRequest);
  assert.throws(() => V.content(promotion({ altText: '' }), { publishing: true, sectionKey: 'promotions' }), badRequest);
  assert.doesNotThrow(() => V.content(promotion({ assetId: null }), { publishing: true, sectionKey: 'safety' }));
  assert.throws(() => V.content(promotion({ action: { type: 'request_ride' } }), { publishing: true, sectionKey: 'safety' }), badRequest);
});

test('actions only allow supported destinations and credential-free HTTPS URLs', () => {
  for (const action of [{ type: 'unknown' }, { type: 'external', url: 'javascript:alert(1)' }, { type: 'external', url: 'http://example.com' }, { type: 'external', url: 'https://user:pass@example.com' }]) {
    assert.throws(() => V.content(promotion({ action })), badRequest);
  }
  assert.equal(V.content(promotion({ action: { type: 'external', url: 'https://gottaxi.co/promo' } })).action.url, 'https://gottaxi.co/promo');
});

test('schedule requires timezone and increasing dates, and rejects expired publication', () => {
  assert.throws(() => V.content(promotion({ startsAt: '2030-01-01T12:00' })), badRequest);
  assert.throws(() => V.content(promotion({ startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' })), badRequest);
  assert.throws(() => V.content(promotion({ endsAt: '2020-01-01T00:00:00Z' }), { publishing: true, sectionKey: 'promotions' }), badRequest);
  assert.equal(V.content(promotion({ startsAt: '2030-01-01T12:00:00-05:00' })).startsAt, '2030-01-01T17:00:00.000Z');
});

test('image validation checks real dimensions, MIME signature and upload limits', () => {
  const png = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12); png.writeUInt32BE(1600,16); png.writeUInt32BE(700,20);
  assert.deepEqual(storage.validateImage({ buffer: png, size: png.length, mimetype: 'image/png' }), { width:1600, height:700 });
  assert.throws(() => storage.validateImage({ buffer: png, size: png.length, mimetype: 'image/jpeg' }), badRequest);
  png.writeUInt32BE(10,16);
  assert.throws(() => storage.validateImage({ buffer: png, size: png.length, mimetype: 'image/png' }), badRequest);
  assert.throws(() => storage.validateImage({ buffer: png, size: 6 * 1024 * 1024, mimetype: 'image/png' }), badRequest);
});

test('editing a published item updates only its draft and requires matching revision', async (t) => {
  const draft = V.content(promotion());
  const statements = mockTransaction(t, async (sql, params) => {
    if (sql.includes('home_content_assets')) return { rows: [{ id: ID }] };
    if (sql.startsWith('UPDATE')) { assert.equal(sql.includes('published='), false); assert.equal(params[3], 3); return { rows: [{ id:ID, revision:4, draft, published:promotion({ title:'Anterior' }) }] }; }
    return { rows: [] };
  });
  const result = await service.saveItem(ID, ID, { sectionKey:'promotions', revision:3, content:promotion() });
  assert.equal(result.published.title, 'Anterior');
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

test('stale edits return conflict and roll back', async (t) => {
  const statements = mockTransaction(t, async (sql) => ({ rows: sql.includes('home_content_assets') ? [{ id:ID }] : [] }));
  await assert.rejects(service.saveItem(ID, ID, { sectionKey:'promotions', revision:1, content:promotion() }), e => e.status === 409);
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
});

test('publishing a second safety card fails without changing the active card', async (t) => {
  const statements = mockTransaction(t, async (sql) => {
    if (sql.startsWith('SELECT section_key')) return { rows:[{ section_key:'safety' }] };
    if (sql.startsWith('SELECT * FROM home_content_items')) return { rows:[{ section_key:'safety', revision:1, draft:promotion({ assetId:null }) }] };
    if (sql.includes("status='published'")) return { rows:[{ id:OTHER }] };
    return { rows:[] };
  });
  await assert.rejects(service.changeStatus(ID, ID, { revision:1 }, true), e => e.status === 409);
  assert.equal(statements.some(s => s.sql.startsWith('UPDATE')), false);
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
});

test('mobile contract uses published data and enforces enabled sections and schedule in SQL', async () => {
  query = async (sql, params) => {
    assert.match(sql, /s.enabled AND i.status='published'/);
    assert.match(sql, /startsAt.*NOW\(\)/s); assert.match(sql, /endsAt.*NOW\(\)/s);
    assert.deepEqual(params, [null]);
    return { rows:[{ key:'promotions',sort_order:10,carousel_interval_seconds:5,id:ID,published:promotion(),asset_id:ID,url:'https://cdn.example/banner.png',width:1600,height:700,published_at:'2030-01-01' }] };
  };
  const result = await service.getHomeContent();
  assert.equal(result.schemaVersion,1); assert.equal(result.sections[0].items[0].action.itemId,ID);
  assert.equal(result.sections[0].items[0].image.width,1600);
  assert.equal('assetId' in result.sections[0].items[0],false);
  assert.equal('draft' in result.sections[0].items[0],false);
  query = async () => ({ rows: [] });
  await assert.rejects(service.getHomeContent(ID), e => e.status === 404);
});

test('images referenced by drafts or published snapshots cannot be deleted from R2', async (t) => {
  let deleted = false; send = async () => { deleted = true; };
  mockTransaction(t, async (sql) => ({ rows: sql.startsWith('SELECT *') ? [{ id:ID, object_key:'home/promotions/test.png' }] : sql.startsWith('SELECT id') ? [{ id:OTHER }] : [] }));
  await assert.rejects(service.deleteAsset(ID), e => e.status === 409);
  assert.equal(deleted,false);
});

test('failed database registration compensates the R2 upload by deleting the object', async (t) => {
  const commands = []; send = async command => { commands.push(command); };
  t.mock.method(database, 'query', async () => { throw new Error('database failure'); });
  // storage captured the original query; force the pool connection to fail instead.
  t.mock.method(database.pool, 'connect', async () => { throw new Error('database failure'); });
  const png = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR',12); png.writeUInt32BE(1600,16); png.writeUInt32BE(700,20);
  await assert.rejects(storage.upload(ID,'promotions',{ buffer:png,size:png.length,mimetype:'image/png' }), /database failure/);
  assert.equal(commands.length,2);
  assert.equal(commands[0].constructor.name,'PutObjectCommand'); assert.equal(commands[1].constructor.name,'DeleteObjectCommand');
  assert.equal(commands[0].input.Key,commands[1].input.Key);
});

test('publication copies validated draft into its published snapshot in one transaction', async (t) => {
  const draft = promotion({ action: { type: 'request_ride' }, blocks: [] });
  let published;
  const statements = mockTransaction(t, async (sql, params) => {
    if (sql.startsWith('SELECT section_key')) return { rows:[{ section_key:'promotions' }] };
    if (sql.startsWith('SELECT * FROM home_content_items')) return { rows:[{ section_key:'promotions', revision:2, draft }] };
    if (sql.includes('home_content_assets')) return { rows:[{ id:ID }] };
    if (sql.startsWith('UPDATE')) { published = params[0]; return { rows:[{ id:ID, revision:3, published }] }; }
    return { rows:[] };
  });
  const result = await service.changeStatus(ID, ID, { revision:2 }, true);
  assert.equal(result.published.title, draft.title);
  assert.equal(result.published.action.type, 'request_ride');
  assert.equal(statements.at(-1).sql, 'COMMIT');
});
