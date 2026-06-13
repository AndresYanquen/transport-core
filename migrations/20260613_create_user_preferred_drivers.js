/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("user_preferred_drivers", (table) => {
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
    table
      .uuid("driver_id")
      .notNullable()
      .references("user_id")
      .inTable("drivers")
      .onDelete("CASCADE");
    table.integer("usage_count").notNullable().defaultTo(0);
    table.timestamp("last_ride_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("deleted_at");

    table.index(["user_id"], "user_preferred_drivers_user_id_idx");
    table.index(["driver_id"], "user_preferred_drivers_driver_id_idx");
    table.index(["user_id", "last_ride_at"], "user_preferred_drivers_user_last_ride_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE user_preferred_drivers
    ADD CONSTRAINT user_preferred_drivers_usage_count_check
    CHECK (usage_count >= 0);
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX user_preferred_drivers_user_driver_unique
    ON user_preferred_drivers (user_id, driver_id)
    WHERE deleted_at IS NULL;
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_user_preferred_drivers_updated_at
    BEFORE UPDATE ON user_preferred_drivers
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_user_preferred_drivers_updated_at
    ON user_preferred_drivers;
  `);

  await knex.schema.raw(`
    DROP INDEX IF EXISTS user_preferred_drivers_user_driver_unique;
  `);

  await knex.schema.raw(`
    ALTER TABLE user_preferred_drivers
    DROP CONSTRAINT IF EXISTS user_preferred_drivers_usage_count_check;
  `);

  await knex.schema.dropTableIfExists("user_preferred_drivers");
};
