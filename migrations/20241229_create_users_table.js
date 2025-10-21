/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  await knex.schema.createTable("users", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("email", 255).notNullable();
    table.string("username", 50);
    table.string("password_hash", 255).notNullable();
    table.string("first_name", 100);
    table.string("last_name", 100);
    table.string("phone_number", 30);
    table
      .string("role", 50)
      .notNullable()
      .defaultTo("user");
    table
      .string("status", 50)
      .notNullable()
      .defaultTo("active");
    table
      .boolean("email_verified")
      .notNullable()
      .defaultTo(false);
    table
      .boolean("phone_verified")
      .notNullable()
      .defaultTo(false);
    table.string("email_verification_token", 255);
    table.timestamp("email_verification_sent_at");
    table.string("phone_verification_token", 255);
    table.timestamp("phone_verification_sent_at");
    table.timestamp("last_login_at");
    table.jsonb("profile").defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("deleted_at");

    table.unique(["email"]);
    table.unique(["username"]);
    table.index(["role"]);
    table.index(["status"]);
    table.index(["email_verified"]);
  });

  await knex.schema.raw(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE 'plpgsql';
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_users_updated_at ON users;
  `);
  await knex.schema.raw(`
    DROP FUNCTION IF EXISTS update_updated_at_column;
  `);
  await knex.schema.dropTableIfExists("users");
};
