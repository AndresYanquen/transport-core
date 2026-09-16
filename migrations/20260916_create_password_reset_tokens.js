/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("password_reset_tokens", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("token_hash", 255).notNullable().unique();
    table.timestamp("expires_at").notNullable();
    table.timestamp("used_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["user_id"], "password_reset_tokens_user_id_idx");
    table.index(["expires_at"], "password_reset_tokens_expires_at_idx");
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("password_reset_tokens");
};
