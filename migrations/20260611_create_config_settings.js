/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("config_settings", (table) => {
    table.string("key", 120).primary();
    table.text("value").notNullable();
    table.text("description");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(`
    ALTER TABLE config_settings
    ADD CONSTRAINT config_settings_key_not_blank_check
    CHECK (length(trim(key)) > 0);
  `);

  await knex("config_settings").insert([
    {
      key: "client_driver_search_radius_meters",
      value: "2000",
      description: "Distance in meters used when searching available drivers near a client pickup location.",
    },
    {
      key: "driver_request_search_radius_meters",
      value: "2000",
      description: "Distance in meters used when searching pending ride requests near a driver.",
    },
  ]);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    ALTER TABLE config_settings
    DROP CONSTRAINT IF EXISTS config_settings_key_not_blank_check;
  `);
  await knex.schema.dropTableIfExists("config_settings");
};
