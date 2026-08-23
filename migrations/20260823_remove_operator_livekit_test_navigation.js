exports.up = async function up(knex) {
  await knex("admin_menu_items")
    .where("code", "operator.operation.radio.activity")
    .delete();
};

exports.down = async function down(knex) {
  await knex("admin_menu_items")
    .insert({
      code: "operator.operation.radio.activity",
      parent_code: "operator.operation.radio",
      label: "Prueba LiveKit",
      slug: "activity",
      path: "/operator/operacion/radio/activity",
      icon: null,
      required_permission: "operator.operation.view",
      sort_order: 10,
      is_active: true,
    })
    .onConflict("code")
    .merge([
      "parent_code",
      "label",
      "slug",
      "path",
      "icon",
      "required_permission",
      "sort_order",
      "is_active",
    ]);
};
