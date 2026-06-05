/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.raw(`
    CREATE UNIQUE INDEX rides_one_active_per_client_idx
    ON rides (client_id)
    WHERE status NOT IN (
      'completed',
      'canceled_by_client',
      'canceled_by_driver',
      'canceled_by_system',
      'no_show'
    );
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP INDEX IF EXISTS rides_one_active_per_client_idx;
  `);
};
