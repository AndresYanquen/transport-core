exports.up = async function (knex) {
  await knex.schema.createTable('home_sections', (t) => {
    t.string('key', 30).primary();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable();
    t.integer('carousel_interval_seconds').notNullable().defaultTo(5);
    t.integer('revision').notNullable().defaultTo(1);
    t.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex('home_sections').insert([
    { key: 'promotions', sort_order: 10 }, { key: 'safety', sort_order: 20 },
  ]);
  await knex.schema.createTable('home_content_assets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('section_key', 30).notNullable().references('key').inTable('home_sections');
    t.text('object_key').notNullable().unique();
    t.text('url').notNullable();
    t.string('mime_type', 30).notNullable();
    t.integer('size_bytes').notNullable();
    t.integer('width').notNullable(); t.integer('height').notNullable();
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('home_content_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('section_key', 30).notNullable().references('key').inTable('home_sections');
    t.string('status', 20).notNullable().defaultTo('draft');
    t.jsonb('draft').notNullable();
    t.jsonb('published');
    t.integer('revision').notNullable().defaultTo(1);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.uuid('published_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('published_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['section_key', 'status']);
  });
  await knex.raw(`ALTER TABLE home_content_items ADD CONSTRAINT home_content_status_check CHECK (status IN ('draft','published','archived'));
    ALTER TABLE home_sections ADD CONSTRAINT home_section_settings_check CHECK (sort_order >= 0 AND carousel_interval_seconds BETWEEN 3 AND 30);
    CREATE UNIQUE INDEX home_safety_one_published ON home_content_items(section_key) WHERE section_key = 'safety' AND status = 'published'`);
};
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('home_content_items');
  await knex.schema.dropTableIfExists('home_content_assets');
  await knex.schema.dropTableIfExists('home_sections');
};
