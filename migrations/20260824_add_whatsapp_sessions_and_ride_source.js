/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasRideSource = await knex.schema.hasColumn("rides", "source");
  if (!hasRideSource) {
    await knex.schema.alterTable("rides", (table) => {
      table.string("source", 50).notNullable().defaultTo("app");
      table.index(["source"], "rides_source_idx");
    });
  }

  const hasWhatsappSessions = await knex.schema.hasTable("whatsapp_sessions");
  if (!hasWhatsappSessions) {
    await knex.schema.createTable("whatsapp_sessions", (table) => {
      table
        .uuid("id")
        .primary()
        .defaultTo(knex.raw("gen_random_uuid()"));
      table.string("phone", 32).notNullable().unique();
      table
        .uuid("user_id")
        .references("id")
        .inTable("users")
        .onDelete("SET NULL");
      table.string("state", 50).notNullable().defaultTo("START");
      table.jsonb("context").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.timestamp("expires_at").notNullable();
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      table.index(["phone"], "whatsapp_sessions_phone_idx");
      table.index(["user_id"], "whatsapp_sessions_user_id_idx");
      table.index(["expires_at"], "whatsapp_sessions_expires_at_idx");
    });

    await knex.schema.raw(`
      CREATE TRIGGER set_whatsapp_sessions_updated_at
      BEFORE UPDATE ON whatsapp_sessions
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp();
    `);
  }

  const hasWhatsappWebhookEvents = await knex.schema.hasTable("whatsapp_webhook_events");
  if (!hasWhatsappWebhookEvents) {
    await knex.schema.createTable("whatsapp_webhook_events", (table) => {
      table
        .uuid("id")
        .primary()
        .defaultTo(knex.raw("gen_random_uuid()"));
      table.string("idempotency_key", 128).notNullable().unique();
      table.string("event_type", 100).notNullable();
      table.timestamp("processed_at");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

      table.index(["event_type"], "whatsapp_webhook_events_event_type_idx");
      table.index(["processed_at"], "whatsapp_webhook_events_processed_at_idx");
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("whatsapp_webhook_events");

  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_whatsapp_sessions_updated_at ON whatsapp_sessions;
  `);
  await knex.schema.dropTableIfExists("whatsapp_sessions");

  const hasRideSource = await knex.schema.hasColumn("rides", "source");
  if (hasRideSource) {
    await knex.schema.alterTable("rides", (table) => {
      table.dropIndex(["source"], "rides_source_idx");
      table.dropColumn("source");
    });
  }
};
