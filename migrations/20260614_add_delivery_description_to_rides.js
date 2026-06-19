/**
 * Kept for Knex migration history compatibility.
 *
 * This migration filename may already be recorded in existing databases. The
 * generic request_description column is handled by the follow-up migration.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasDeliveryDescription = await knex.schema.hasColumn(
    "rides",
    "delivery_description"
  );
  const hasRequestDescription = await knex.schema.hasColumn(
    "rides",
    "request_description"
  );

  if (!hasDeliveryDescription && !hasRequestDescription) {
    await knex.schema.alterTable("rides", (table) => {
      table.text("delivery_description");
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasDeliveryDescription = await knex.schema.hasColumn(
    "rides",
    "delivery_description"
  );

  if (hasDeliveryDescription) {
    await knex.schema.alterTable("rides", (table) => {
      table.dropColumn("delivery_description");
    });
  }
};
