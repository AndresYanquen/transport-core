/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("operational_zones", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 120).notNullable();
    table.string("type", 50).notNullable().defaultTo("operational");
    table.string("status", 50).notNullable().defaultTo("active");
    table.string("color", 20);
    table.specificType("polygon", "geography(Polygon, 4326)").notNullable();
    table.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["type", "status"], "operational_zones_type_status_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE operational_zones
    ADD CONSTRAINT operational_zones_name_not_blank_check
    CHECK (length(trim(name)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE operational_zones
    ADD CONSTRAINT operational_zones_type_check
    CHECK (type IN ('operational', 'hot_zone', 'restricted', 'pricing_zone'));
  `);

  await knex.schema.raw(`
    ALTER TABLE operational_zones
    ADD CONSTRAINT operational_zones_status_check
    CHECK (status IN ('active', 'inactive'));
  `);

  await knex.schema.raw(`
    ALTER TABLE operational_zones
    ADD CONSTRAINT operational_zones_color_check
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
  `);

  await knex.schema.raw(`
    CREATE INDEX operational_zones_polygon_idx
    ON operational_zones
    USING GIST (polygon);
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_operational_zones_updated_at
    BEFORE UPDATE ON operational_zones
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_operational_zones_updated_at ON operational_zones;
  `);
  await knex.schema.raw(`
    DROP INDEX IF EXISTS operational_zones_polygon_idx;
  `);
  await knex.schema.raw(`
    ALTER TABLE operational_zones
    DROP CONSTRAINT IF EXISTS operational_zones_color_check;
  `);
  await knex.schema.raw(`
    ALTER TABLE operational_zones
    DROP CONSTRAINT IF EXISTS operational_zones_status_check;
  `);
  await knex.schema.raw(`
    ALTER TABLE operational_zones
    DROP CONSTRAINT IF EXISTS operational_zones_type_check;
  `);
  await knex.schema.raw(`
    ALTER TABLE operational_zones
    DROP CONSTRAINT IF EXISTS operational_zones_name_not_blank_check;
  `);
  await knex.schema.dropTableIfExists("operational_zones");
};
