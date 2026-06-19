/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasRequestDescription = await knex.schema.hasColumn(
    "rides",
    "request_description"
  );
  const hasDeliveryDescription = await knex.schema.hasColumn(
    "rides",
    "delivery_description"
  );

  if (!hasRequestDescription && hasDeliveryDescription) {
    await knex.schema.alterTable("rides", (table) => {
      table.renameColumn("delivery_description", "request_description");
    });
    return;
  }

  if (!hasRequestDescription) {
    await knex.schema.alterTable("rides", (table) => {
      table.text("request_description");
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasRequestDescription = await knex.schema.hasColumn(
    "rides",
    "request_description"
  );
  const hasDeliveryDescription = await knex.schema.hasColumn(
    "rides",
    "delivery_description"
  );

  if (hasRequestDescription && !hasDeliveryDescription) {
    await knex.schema.alterTable("rides", (table) => {
      table.renameColumn("request_description", "delivery_description");
    });
    return;
  }

  if (hasRequestDescription) {
    await knex.schema.alterTable("rides", (table) => {
      table.dropColumn("request_description");
    });
  }
};
