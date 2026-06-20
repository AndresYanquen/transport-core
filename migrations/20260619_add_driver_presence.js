exports.up = async function up(knex) {
  await knex.schema.alterTable("drivers", (table) => {
    table.timestamp("last_seen_at");
    table.string("offline_reason", 50);
    table.string("availability_intent", 50).notNullable().defaultTo("offline");
    table.index(["status", "last_seen_at"], "drivers_status_last_seen_idx");
  });

  await knex.raw(`
    UPDATE drivers
    SET
      last_seen_at = CASE WHEN status IN ('online', 'busy') THEN NOW() ELSE NULL END,
      availability_intent = CASE
        WHEN status IN ('online', 'busy') THEN 'online'
        WHEN status = 'unavailable' THEN 'unavailable'
        ELSE 'offline'
      END
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("drivers", (table) => {
    table.dropIndex(["status", "last_seen_at"], "drivers_status_last_seen_idx");
    table.dropColumn("availability_intent");
    table.dropColumn("offline_reason");
    table.dropColumn("last_seen_at");
  });
};
