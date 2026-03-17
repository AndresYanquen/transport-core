/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("ride_driver_invites", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("ride_id")
      .notNullable()
      .references("id")
      .inTable("rides")
      .onDelete("CASCADE");
    table
      .uuid("driver_id")
      .notNullable()
      .references("user_id")
      .inTable("drivers")
      .onDelete("CASCADE");
    table
      .string("status", 20)
      .notNullable()
      .defaultTo("pending");
    table.timestamp("invited_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("responded_at");

    table.unique(["ride_id", "driver_id"], "ride_driver_invites_unique");
    table.index(["ride_id"], "ride_driver_invites_ride_id_idx");
    table.index(["driver_id"], "ride_driver_invites_driver_id_idx");
    table.index(["status"], "ride_driver_invites_status_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE ride_driver_invites
    ADD CONSTRAINT ride_driver_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'));
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    ALTER TABLE ride_driver_invites
    DROP CONSTRAINT IF EXISTS ride_driver_invites_status_check;
  `);

  await knex.schema.dropTableIfExists("ride_driver_invites");
};
