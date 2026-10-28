exports.up = async function up(knex) {
  await knex.schema.createTable("user_push_devices", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.text("fcm_token").unique();
    t.string("platform", 10).notNullable();
    t.uuid("installation_id").notNullable();
    t.uuid("session_id").references("id").inTable("auth_mobile_sessions").onDelete("CASCADE");
    t.integer("security_version").notNullable();
    t.timestamp("authorized_until", { useTz: true });
    t.uuid("registration_version").notNullable().defaultTo(knex.raw("gen_random_uuid()"));
    t.boolean("enabled").notNullable().defaultTo(true);
    for (const name of ["last_seen_at", "created_at", "updated_at"]) {
      t.timestamp(name, { useTz: true }).notNullable().defaultTo(knex.fn.now());
    }
    t.unique(["user_id", "installation_id"]);
    t.index(["user_id", "enabled"]);
    t.index(["session_id"]);
  });
  await knex.raw(`ALTER TABLE user_push_devices
    ADD CONSTRAINT push_device_platform CHECK (platform IN ('android', 'ios', 'web')),
    ADD CONSTRAINT push_device_enabled_token CHECK (NOT enabled OR fcm_token IS NOT NULL),
    ADD CONSTRAINT push_device_authorization CHECK (session_id IS NOT NULL OR authorized_until IS NOT NULL)`);
  await knex.schema.createTable("push_deliveries", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("event_id", 200).notNullable();
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.uuid("device_id").notNullable().references("id").inTable("user_push_devices").onDelete("CASCADE");
    t.uuid("registration_version").notNullable();
    t.jsonb("payload").notNullable();
    t.string("status", 20).notNullable().defaultTo("pending");
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("expires_at", { useTz: true }).notNullable();
    t.timestamp("available_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("lease_until", { useTz: true });
    t.uuid("lease_id");
    t.string("last_error", 100);
    t.text("provider_message_id");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(["event_id", "user_id", "device_id"]);
    t.index(["status", "available_at"]);
  });
  await knex.raw(`ALTER TABLE push_deliveries ADD CONSTRAINT push_delivery_status
    CHECK (status IN ('pending', 'processing', 'accepted', 'discarded', 'failed'))`);
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("push_deliveries");
  await knex.schema.dropTableIfExists("user_push_devices");
};
