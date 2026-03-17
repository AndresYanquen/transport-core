/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasHeading = await knex.schema.hasColumn("drivers", "heading_degrees");
  if (!hasHeading) {
    await knex.schema.alterTable("drivers", (table) => {
      table.double("heading_degrees");
      table.double("speed_kmh");
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasHeading = await knex.schema.hasColumn("drivers", "heading_degrees");
  if (hasHeading) {
    await knex.schema.alterTable("drivers", (table) => {
      table.dropColumn("heading_degrees");
      table.dropColumn("speed_kmh");
    });
  }
};
