/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.string("email", 255).nullable().alter();
    table.string("password_hash", 255).nullable().alter();
    table.string("phone_number", 16).alter();
  });

  await knex.raw("DROP INDEX IF EXISTS users_email_unique_not_null;");
  await knex.raw("DROP INDEX IF EXISTS users_client_phone_unique_not_null;");
  await knex.raw("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;");

  await knex.raw(`
    UPDATE users
    SET email = NULL,
        password_hash = NULL
    WHERE email LIKE 'phone-%@phone.local'
      AND profile->>'phoneOnly' = 'true';
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX users_email_unique_not_null
    ON users (LOWER(email))
    WHERE email IS NOT NULL AND deleted_at IS NULL;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX users_client_phone_unique_not_null
    ON users (phone_number)
    WHERE role = 'client'
      AND phone_number IS NOT NULL
      AND deleted_at IS NULL;
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS users_client_phone_unique_not_null;");
  await knex.raw("DROP INDEX IF EXISTS users_email_unique_not_null;");

  await knex.raw(`
    UPDATE users
    SET email = 'phone-' || regexp_replace(phone_number, '[^0-9A-Za-z]+', '', 'g') || '-' || id || '@phone.local'
    WHERE email IS NULL;
  `);

  await knex.schema.alterTable("users", (table) => {
    table.string("email", 255).notNullable().alter();
    table.string("password_hash", 255).notNullable().alter();
    table.string("phone_number", 30).alter();
  });

  await knex.raw("ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);");
};
