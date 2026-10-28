exports.up = async function up(knex) {
  await knex.schema.alterTable("user_push_devices", (t) => {
    t.string("app_visibility", 16).notNullable().defaultTo("unknown");
    t.timestamp("visibility_reported_at", { useTz: true });
    t.timestamp("visibility_valid_until", { useTz: true });
  });
  await knex.raw(`ALTER TABLE user_push_devices ADD CONSTRAINT push_device_visibility
    CHECK (app_visibility IN ('foreground','background','unknown'))`);
  await knex.schema.alterTable("push_deliveries", (t) => {
    t.timestamp("presented_at", { useTz: true });
    t.timestamp("dispatch_started_at", { useTz: true });
  });
  await knex.raw("ALTER TABLE push_deliveries DROP CONSTRAINT push_delivery_status");
  await knex.raw(`ALTER TABLE push_deliveries ADD CONSTRAINT push_delivery_status
    CHECK (status IN ('pending','processing','accepted','discarded','failed','suppressed'))`);
};
exports.down = async function down(knex) {
  await knex("push_deliveries").where({ status: "suppressed" }).update({ status: "discarded" });
  await knex.raw("ALTER TABLE push_deliveries DROP CONSTRAINT push_delivery_status");
  await knex.raw(`ALTER TABLE push_deliveries ADD CONSTRAINT push_delivery_status
    CHECK (status IN ('pending','processing','accepted','discarded','failed'))`);
  await knex.schema.alterTable("push_deliveries", (t) => {
    t.dropColumn("presented_at");
    t.dropColumn("dispatch_started_at");
  });
  await knex.raw("ALTER TABLE user_push_devices DROP CONSTRAINT push_device_visibility");
  await knex.schema.alterTable("user_push_devices", (t) => {
    t.dropColumn("app_visibility");
    t.dropColumn("visibility_reported_at");
    t.dropColumn("visibility_valid_until");
  });
};
