/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "postgis";');

  const hasClientHome = await knex.schema.hasColumn("clients", "home_location");
  if (!hasClientHome) {
    await knex.schema.alterTable("clients", (table) => {
      table.specificType("home_location", "geography(Point, 4326)");
    });
    await knex.schema.raw(`
      CREATE INDEX IF NOT EXISTS clients_home_location_idx
      ON clients
      USING GIST (home_location);
    `);
  }

  const hasDriverLocation = await knex.schema.hasColumn("drivers", "current_location");
  if (!hasDriverLocation) {
    await knex.schema.alterTable("drivers", (table) => {
      table.specificType("current_location", "geography(Point, 4326)");
    });
    await knex.schema.raw(`
      CREATE INDEX IF NOT EXISTS drivers_current_location_idx
      ON drivers
      USING GIST (current_location);
    `);
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasClientHome = await knex.schema.hasColumn("clients", "home_location");
  if (hasClientHome) {
    await knex.schema.raw(`
      DROP INDEX IF EXISTS clients_home_location_idx;
    `);
    await knex.schema.alterTable("clients", (table) => {
      table.dropColumn("home_location");
    });
  }

  const hasDriverLocation = await knex.schema.hasColumn("drivers", "current_location");
  if (hasDriverLocation) {
    await knex.schema.raw(`
      DROP INDEX IF EXISTS drivers_current_location_idx;
    `);
    await knex.schema.alterTable("drivers", (table) => {
      table.dropColumn("current_location");
    });
  }
};
