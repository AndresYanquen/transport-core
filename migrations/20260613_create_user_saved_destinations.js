/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "postgis";');

  await knex.schema.createTable("user_saved_destinations", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("label", 100).notNullable();
    table.string("place_name", 255).notNullable();
    table.string("formatted_address", 500);
    table.string("place_id", 255);
    table.specificType("location", "geography(Point, 4326)").notNullable();
    table.integer("usage_count").notNullable().defaultTo(0);
    table.timestamp("last_used_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("deleted_at");

    table.index(["user_id"], "user_saved_destinations_user_id_idx");
    table.index(["user_id", "last_used_at"], "user_saved_destinations_user_last_used_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE user_saved_destinations
    ADD CONSTRAINT user_saved_destinations_label_not_blank_check
    CHECK (length(trim(label)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE user_saved_destinations
    ADD CONSTRAINT user_saved_destinations_place_name_not_blank_check
    CHECK (length(trim(place_name)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE user_saved_destinations
    ADD CONSTRAINT user_saved_destinations_usage_count_check
    CHECK (usage_count >= 0);
  `);

  await knex.schema.raw(`
    CREATE INDEX user_saved_destinations_location_idx
    ON user_saved_destinations
    USING GIST (location);
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX user_saved_destinations_user_place_id_unique
    ON user_saved_destinations (user_id, place_id)
    WHERE place_id IS NOT NULL
      AND deleted_at IS NULL;
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_user_saved_destinations_updated_at
    BEFORE UPDATE ON user_saved_destinations
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_user_saved_destinations_updated_at
    ON user_saved_destinations;
  `);

  await knex.schema.raw(`
    DROP INDEX IF EXISTS user_saved_destinations_user_place_id_unique;
  `);

  await knex.schema.raw(`
    DROP INDEX IF EXISTS user_saved_destinations_location_idx;
  `);

  await knex.schema.raw(`
    ALTER TABLE user_saved_destinations
    DROP CONSTRAINT IF EXISTS user_saved_destinations_usage_count_check;
  `);

  await knex.schema.raw(`
    ALTER TABLE user_saved_destinations
    DROP CONSTRAINT IF EXISTS user_saved_destinations_place_name_not_blank_check;
  `);

  await knex.schema.raw(`
    ALTER TABLE user_saved_destinations
    DROP CONSTRAINT IF EXISTS user_saved_destinations_label_not_blank_check;
  `);

  await knex.schema.dropTableIfExists("user_saved_destinations");
};
