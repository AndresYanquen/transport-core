exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (t) => t.integer("security_version").notNullable().defaultTo(0));
  await knex.schema.createTable("user_change_audit", (t) => {
    t.bigIncrements("id");
    t.uuid("actor_id").notNullable().references("id").inTable("users");
    t.uuid("user_id").notNullable().references("id").inTable("users");
    t.string("action", 50).notNullable();
    t.jsonb("fields").notNullable();
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["user_id", "created_at"]);
  });
  await knex.schema.createTable("auth_identity_challenges", (t) => {
    t.uuid("id").primary();
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("purpose", 30).notNullable();
    t.string("token_hash", 64).notNullable();
    t.string("target", 255).notNullable();
    t.string("credential_version", 64).notNullable();
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("used_at", { useTz: true });
    t.timestamp("expires_at", { useTz: true }).notNullable();
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["user_id", "purpose", "created_at"]);
  });
  await knex.schema.alterTable("auth_phone_sms_requests", (t) => t.string("credential_version", 64));
  for (const [table, constraint] of [["auth_phone_otps", "auth_phone_otp_purpose_check"], ["auth_phone_sms_requests", "auth_phone_sms_purpose_check"]]) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK ((purpose = 'auth' AND target_user_id IS NULL) OR (purpose IN ('link', 'change') AND target_user_id IS NOT NULL))`);
  }
};
exports.down = async function down(knex) {
  for (const [table, constraint] of [["auth_phone_otps", "auth_phone_otp_purpose_check"], ["auth_phone_sms_requests", "auth_phone_sms_purpose_check"]]) {
    await knex(table).where({ purpose: "change" }).delete();
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK ((purpose = 'auth' AND target_user_id IS NULL) OR (purpose = 'link' AND target_user_id IS NOT NULL))`);
  }
  await knex.schema.alterTable("auth_phone_sms_requests", (t) => t.dropColumn("credential_version"));
  await knex.schema.dropTable("auth_identity_challenges");
  await knex.schema.dropTable("user_change_audit");
  await knex.schema.alterTable("users", (t) => t.dropColumn("security_version"));
};
