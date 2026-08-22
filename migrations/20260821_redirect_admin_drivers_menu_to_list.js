exports.up = async function up(knex) {
  await knex("admin_menu_items")
    .where("code", "drivers")
    .update({
      path: "/admin/conductores/list",
      updated_at: knex.fn.now(),
    });
};

exports.down = async function down(knex) {
  await knex("admin_menu_items")
    .where("code", "drivers")
    .update({
      path: "/admin/conductores",
      updated_at: knex.fn.now(),
    });
};
