function item(code, parentCode, label, slug, path, icon, sortOrder) {
  return {
    code,
    parent_code: parentCode,
    label,
    slug,
    path,
    icon,
    required_permission: null,
    sort_order: sortOrder,
    is_active: true,
  };
}

exports.up = async function up(knex) {
  await knex("admin_menu_items")
    .insert([
      item(
        "operation.incidents.panic",
        "operation.incidents",
        "Pánico",
        "panico",
        "/admin/operacion/incidentes/panico",
        null,
        5
      ),
      item(
        "operator.incidents.panic",
        "operator.incidents",
        "Pánico",
        "panico",
        "/operator/operacion/incidentes/panico",
        null,
        5
      ),
    ])
    .onConflict("code")
    .merge(["parent_code", "label", "slug", "path", "icon", "sort_order", "is_active"]);

  await knex("admin_menu_items")
    .where("code", "operator.incidents")
    .update({
      parent_code: "operator.operation",
      path: "/operator/operacion/incidentes",
      icon: null,
      sort_order: 70,
      updated_at: knex.fn.now(),
    });
};

exports.down = async function down(knex) {
  await knex("admin_menu_items")
    .whereIn("code", [
      "operation.incidents.panic",
      "operator.incidents.panic",
    ])
    .delete();

  await knex("admin_menu_items")
    .where("code", "operator.incidents")
    .update({
      parent_code: null,
      path: "/operator/incidentes",
      icon: "triangle-alert",
      sort_order: 70,
      updated_at: knex.fn.now(),
    });
};
