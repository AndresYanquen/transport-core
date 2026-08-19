/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable("rides", (table) => {
    table.string("tracking_token", 96).unique();
  });

  await knex.schema.raw(`
    UPDATE rides
    SET tracking_token = translate(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_')
    WHERE tracking_token IS NULL;
  `);

  await knex.schema.alterTable("rides", (table) => {
    table.string("tracking_token", 96).notNullable().alter();
  });

  await knex.schema.raw(`
    ALTER TABLE rides
    ALTER COLUMN tracking_token
    SET DEFAULT translate(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX rides_tracking_token_idx
    ON rides (tracking_token);
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw("DROP INDEX IF EXISTS rides_tracking_token_idx;");
  await knex.schema.raw(`
    ALTER TABLE rides
    ALTER COLUMN tracking_token
    DROP DEFAULT;
  `);
  await knex.schema.alterTable("rides", (table) => {
    table.dropColumn("tracking_token");
  });
};
