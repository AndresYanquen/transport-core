/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn("rides", "has_destination");
  if (!hasColumn) {
    await knex.schema.alterTable("rides", (table) => {
      table.boolean("has_destination").notNullable().defaultTo(false);
    });
  }

  await knex.schema.raw(`
    UPDATE rides
    SET has_destination = (
      dropoff_point IS NOT NULL
      OR (dropoff_address IS NOT NULL AND LENGTH(TRIM(dropoff_address)) > 0)
    )
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn("rides", "has_destination");
  if (hasColumn) {
    await knex.schema.alterTable("rides", (table) => {
      table.dropColumn("has_destination");
    });
  }
};
