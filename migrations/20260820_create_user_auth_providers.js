/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("user_auth_providers", (table) => {
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
    table.string("provider", 50).notNullable();
    table.string("provider_user_id", 255).notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["provider", "provider_user_id"], {
      indexName: "user_auth_providers_provider_user_unique",
    });
    table.unique(["user_id", "provider"], {
      indexName: "user_auth_providers_user_provider_unique",
    });
    table.index(["user_id"], "user_auth_providers_user_id_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE user_auth_providers
    ADD CONSTRAINT user_auth_providers_provider_not_blank_check
    CHECK (length(trim(provider)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE user_auth_providers
    ADD CONSTRAINT user_auth_providers_provider_user_id_not_blank_check
    CHECK (length(trim(provider_user_id)) > 0);
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_user_auth_providers_updated_at
    BEFORE UPDATE ON user_auth_providers
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_auth_providers");
};
