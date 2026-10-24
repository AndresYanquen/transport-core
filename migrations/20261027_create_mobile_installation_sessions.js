exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.boolean("mobile_additional_factor_required").notNullable().defaultTo(false);
  });
  await knex.schema.createTable("auth_mobile_sessions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("installation_id").notNullable();
    table.uuid("family_id").notNullable().unique();
    table.string("device_name", 100);
    table.string("platform", 16);
    table.string("app_version", 50);
    table.string("os_version", 50);
    table.string("auth_method", 32).notNullable().defaultTo("sms_otp");
    table.boolean("remember_me").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("last_used_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("absolute_expires_at", { useTz: true }).notNullable();
    table.timestamp("revoked_at", { useTz: true });
    table.text("revoked_reason");
    table.unique(["id", "user_id", "family_id"], { indexName: "auth_mobile_sessions_token_owner_unique" });
    table.index(["user_id"]);
  });
  await knex.raw(`CREATE UNIQUE INDEX auth_mobile_sessions_active_installation_unique
    ON auth_mobile_sessions (user_id, installation_id) WHERE revoked_at IS NULL`);
  await knex.raw(`ALTER TABLE auth_mobile_sessions ADD CONSTRAINT auth_mobile_sessions_expiry_check
    CHECK (expires_at <= absolute_expires_at)`);
  await knex.schema.alterTable("auth_refresh_tokens", (table) => {
    table.uuid("session_id");
    table.index(["session_id"]);
    table.foreign(["session_id", "user_id", "family_id"], "auth_refresh_tokens_mobile_session_fk")
      .references(["id", "user_id", "family_id"]).inTable("auth_mobile_sessions").onDelete("CASCADE");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("auth_refresh_tokens", (table) => {
    table.dropForeign(["session_id", "user_id", "family_id"], "auth_refresh_tokens_mobile_session_fk");
    table.dropColumn("session_id");
  });
  await knex.schema.dropTable("auth_mobile_sessions");
  await knex.schema.alterTable("users", (table) => table.dropColumn("mobile_additional_factor_required"));
};
