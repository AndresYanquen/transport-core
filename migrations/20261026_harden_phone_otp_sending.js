exports.up = async function up(knex) {
  await knex.schema.alterTable("auth_phone_otps", (table) => {
    table.string("purpose", 16).notNullable().defaultTo("auth");
    table.uuid("target_user_id");
  });
  await knex.raw(`ALTER TABLE auth_phone_otps ADD CONSTRAINT auth_phone_otp_purpose_check
    CHECK ((purpose = 'auth' AND target_user_id IS NULL) OR (purpose = 'link' AND target_user_id IS NOT NULL))`);
  await knex.schema.createTable("auth_phone_sms_requests", (table) => {
    table.uuid("challenge_id").primary();
    table.uuid("request_id").notNullable().unique();
    table.string("phone_key", 64).notNullable();
    table.string("device_key", 64).notNullable();
    table.string("ip_key", 64).notNullable();
    table.string("account_type", 16).notNullable();
    table.string("purpose", 16).notNullable().defaultTo("auth");
    table.uuid("target_user_id");
    table.string("status", 16).notNullable().defaultTo("pending");
    table.string("provider_reference", 128);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("expires_at", { useTz: true }).notNullable();
    for (const key of ["phone_key", "device_key", "ip_key"]) table.index([key, "created_at"]);
    table.index(["created_at"]);
  });
  await knex.raw(`ALTER TABLE auth_phone_sms_requests ADD CONSTRAINT auth_phone_sms_status_check
    CHECK (status IN ('pending', 'sent', 'failed', 'unknown'))`);
  await knex.raw(`ALTER TABLE auth_phone_sms_requests ADD CONSTRAINT auth_phone_sms_purpose_check
    CHECK ((purpose = 'auth' AND target_user_id IS NULL) OR (purpose = 'link' AND target_user_id IS NOT NULL))`);
  await knex.schema.createTable("auth_phone_sms_control", (table) => {
    table.integer("id").primary();
    table.timestamp("blocked_until", { useTz: true });
    table.string("blocked_reason", 32);
  });
  await knex("auth_phone_sms_control").insert({ id: 1 });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable("auth_phone_sms_control");
  await knex.schema.dropTable("auth_phone_sms_requests");
  await knex.raw("ALTER TABLE auth_phone_otps DROP CONSTRAINT auth_phone_otp_purpose_check");
  await knex.schema.alterTable("auth_phone_otps", (table) => {
    table.dropColumn("target_user_id");
    table.dropColumn("purpose");
  });
};
