exports.up = async function up(knex) {
  await knex.schema.createTable("driver_notifications", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("driver_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("ride_id").references("id").inTable("rides").onDelete("SET NULL");
    table.string("type", 40).notNullable();
    table.string("priority", 30).notNullable().defaultTo("normal");
    table.string("status", 30).notNullable().defaultTo("unread");
    table.string("title", 120).notNullable();
    table.text("message").notNullable();
    table.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.uuid("acknowledged_by_user_id").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("acknowledged_at");
    table.uuid("resolved_by_user_id").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("resolved_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["status", "priority", "created_at"], "driver_notifications_queue_idx");
    table.index(["driver_id", "type", "created_at"], "driver_notifications_driver_type_idx");
  });

  await knex.schema.raw(`
    CREATE TRIGGER set_driver_notifications_updated_at
    BEFORE UPDATE ON driver_notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("driver_notifications");
};
