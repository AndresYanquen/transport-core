exports.up = async function up(knex) {
  await knex.raw("DROP INDEX users_client_phone_unique_not_null");
  await knex.raw(`
    CREATE UNIQUE INDEX users_mobile_phone_unique_not_null
    ON users (phone_number)
    WHERE role IN ('client', 'driver')
      AND phone_number IS NOT NULL AND deleted_at IS NULL
  `);
  await knex.raw(`
    ALTER TABLE users ADD CONSTRAINT users_mobile_phone_e164_check
    CHECK (role NOT IN ('client', 'driver') OR phone_number IS NULL
      OR phone_number ~ '^\\+[1-9][0-9]{1,14}$')
  `);
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE users DROP CONSTRAINT users_mobile_phone_e164_check");
  await knex.raw("DROP INDEX users_mobile_phone_unique_not_null");
  await knex.raw(`
    CREATE UNIQUE INDEX users_client_phone_unique_not_null
    ON users (phone_number)
    WHERE role = 'client' AND phone_number IS NOT NULL AND deleted_at IS NULL
  `);
};
