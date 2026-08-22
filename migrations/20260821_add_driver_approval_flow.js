exports.up = async function up(knex) {
  await knex.schema.alterTable("drivers", (table) => {
    table.string("approval_status", 40).notNullable().defaultTo("pending");
    table.text("approval_notes");
    table.uuid("reviewed_by_admin_id").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("reviewed_at");
    table.index(["approval_status"], "drivers_approval_status_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE drivers
    ADD CONSTRAINT drivers_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'changes_requested', 'suspended'));
  `);

  await knex("config_settings")
    .insert({
      key: "driver_creation_approval_policy",
      value: "pending",
      description: "Controls whether newly created drivers require approval or are approved immediately.",
    })
    .onConflict("key")
    .ignore();
};

exports.down = async function down(knex) {
  await knex("config_settings").where({ key: "driver_creation_approval_policy" }).delete();
  await knex.schema.raw(`
    ALTER TABLE drivers
    DROP CONSTRAINT IF EXISTS drivers_approval_status_check;
  `);
  await knex.schema.alterTable("drivers", (table) => {
    table.dropIndex(["approval_status"], "drivers_approval_status_idx");
    table.dropColumn("reviewed_at");
    table.dropColumn("reviewed_by_admin_id");
    table.dropColumn("approval_notes");
    table.dropColumn("approval_status");
  });
};
