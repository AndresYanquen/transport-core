/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("auth_refresh_tokens", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.text("token_hash").notNullable().unique();
    table
      .uuid("family_id")
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.timestamp("expires_at").notNullable();
    table.timestamp("revoked_at");
    table
      .uuid("replaced_by_token_id")
      .references("id")
      .inTable("auth_refresh_tokens")
      .onDelete("SET NULL");
    table.text("created_by_ip");
    table.text("created_by_user_agent");
    table.text("revoked_reason");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["user_id"], "auth_refresh_tokens_user_id_idx");
    table.index(["family_id"], "auth_refresh_tokens_family_id_idx");
    table.index(["expires_at"], "auth_refresh_tokens_expires_at_idx");
    table.index(["revoked_at"], "auth_refresh_tokens_revoked_at_idx");
  });

  await knex.schema.raw(`
    CREATE TRIGGER set_auth_refresh_tokens_updated_at
    BEFORE UPDATE ON auth_refresh_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("auth_refresh_tokens");
};
