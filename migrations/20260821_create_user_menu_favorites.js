exports.up = async function up(knex) {
  await knex.schema.createTable("user_menu_favorites", (table) => {
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("menu_item_code", 120).notNullable().references("code").inTable("admin_menu_items").onDelete("CASCADE");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.primary(["user_id", "menu_item_code"]);
    table.index(["user_id", "sort_order"], "user_menu_favorites_user_sort_idx");
  });

  await knex.schema.raw(`
    CREATE TRIGGER set_user_menu_favorites_updated_at
    BEFORE UPDATE ON user_menu_favorites
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_menu_favorites");
};
