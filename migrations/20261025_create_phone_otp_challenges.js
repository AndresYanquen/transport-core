exports.up = async function up(knex) {
  await knex.schema.createTable("auth_phone_otps", (table) => {
    table.string("phone_number", 16).primary();
    table.uuid("challenge_id").notNullable().unique();
    table.string("account_type", 16).notNullable();
    table.string("code_hash", 64).notNullable();
    table.string("status", 16).notNullable().defaultTo("pending");
    table.integer("attempts").notNullable().defaultTo(0);
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(["expires_at"]);
  });
  await knex.raw(`ALTER TABLE auth_phone_otps
    ADD CONSTRAINT auth_phone_otps_account_type_check CHECK (account_type IN ('client', 'driver')),
    ADD CONSTRAINT auth_phone_otps_status_check CHECK (status IN ('pending', 'sent', 'failed', 'consumed')),
    ADD CONSTRAINT auth_phone_otps_attempts_check CHECK (attempts BETWEEN 0 AND 5)`);
  await knex.schema.createTable("auth_phone_rate_limits", (table) => {
    table.string("key", 128).primary();
    table.integer("used").notNullable();
    table.timestamp("reset_at", { useTz: true }).notNullable();
    table.index(["reset_at"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable("auth_phone_rate_limits");
  await knex.schema.dropTable("auth_phone_otps");
};
