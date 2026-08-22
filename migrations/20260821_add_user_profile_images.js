exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.text("profile_image_url");
    table.text("profile_image_key");
    table.timestamp("profile_image_updated_at");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("profile_image_updated_at");
    table.dropColumn("profile_image_key");
    table.dropColumn("profile_image_url");
  });
};
