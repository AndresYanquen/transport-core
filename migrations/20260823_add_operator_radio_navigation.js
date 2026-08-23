function item(code, parentCode, label, slug, path, sortOrder) {
  return {
    code,
    parent_code: parentCode,
    label,
    slug,
    path,
    icon: null,
    required_permission: "operator.operation.view",
    sort_order: sortOrder,
    is_active: true,
  };
}

exports.up = async function up(knex) {
  await knex("admin_menu_items")
    .insert([
      item("operator.operation.radio", "operator.operation", "Radio", "radio", "/operator/operacion/radio", 65),
    ])
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

exports.down = async function down(knex) {
  await knex("admin_menu_items")
    .whereIn("code", ["operator.operation.radio"])
    .delete();
};
