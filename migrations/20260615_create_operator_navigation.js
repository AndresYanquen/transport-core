/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.raw(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;
  `);

  await knex.schema.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'operator', 'client', 'driver'));
  `);

  const sections = [
    ["dashboard", "Dashboard", "layout-dashboard"],
    ["operation", "Operación", "radio-tower"],
    ["realtime_map", "Mapa en Tiempo Real", "map"],
    ["assignments", "Asignaciones", "user-check"],
    ["drivers", "Conductores", "car"],
    ["customers", "Clientes", "users"],
    ["incidents", "Incidentes", "triangle-alert"],
    ["notifications", "Notificaciones", "bell"],
  ];

  const permissions = sections.map(([code, label]) => ({
    code: `operator.${code}.view`,
    name: `${label}: ver`,
    description: `Permite ver el módulo ${label} del panel de operadora.`,
  }));

  await knex("admin_permissions")
    .insert(permissions)
    .onConflict("code")
    .merge(["name", "description"]);

  await knex("admin_role_permissions")
    .insert(
      permissions.map((permission) => ({
        role: "operator",
        permission_code: permission.code,
      })),
    )
    .onConflict(["role", "permission_code"])
    .ignore();

  const menuItems = [
    group("operator.dashboard", null, "Dashboard", "dashboard", "/operator", "layout-dashboard", 10, [
      ["shift_summary", "Resumen del Turno"],
      ["pending_requests", "Solicitudes Pendientes"],
      ["available_drivers", "Conductores Disponibles"],
      ["alerts", "Alertas"],
    ]),
    group("operator.operation", null, "Operación", "operacion", "/operator/operacion", "radio-tower", 20, [
      ["new_request", "Nueva Solicitud"],
      ["pending_requests", "Solicitudes Pendientes"],
      ["assigned_requests", "Solicitudes Asignadas"],
      ["services_in_progress", "Servicios En Curso"],
      ["completed_services", "Servicios Finalizados"],
      ["canceled_services", "Servicios Cancelados"],
      ["radio", "Radio"],
    ]),
    group("operator.realtime_map", null, "Mapa en Tiempo Real", "mapa-en-tiempo-real", "/operator/mapa", "map", 30, [
      ["drivers", "Conductores"],
      ["requests", "Solicitudes"],
      ["active_services", "Servicios Activos"],
      ["hot_zones", "Hot Zones"],
    ]),
    group("operator.assignments", null, "Asignaciones", "asignaciones", "/operator/asignaciones", "user-check", 40, [
      ["assign_driver", "Asignar Conductor"],
      ["reassign_service", "Reasignar Servicio"],
      ["no_response", "Sin Respuesta"],
      ["history", "Historial"],
    ]),
    group("operator.drivers", null, "Conductores", "conductores", "/operator/conductores", "car", 50, [
      ["available", "Disponibles"],
      ["busy", "Ocupados"],
      ["disconnected", "Desconectados"],
      ["search_driver", "Buscar Conductor"],
    ]),
    group("operator.customers", null, "Clientes", "clientes", "/operator/clientes", "users", 60, [
      ["search_customer", "Buscar Cliente"],
      ["history", "Historial"],
      ["create_customer", "Crear Cliente"],
    ]),
    group("operator.incidents", null, "Incidentes", "incidentes", "/operator/incidentes", "triangle-alert", 70, [
      ["cancellations", "Cancelaciones"],
      ["complaints", "Quejas"],
      ["customer_no_show", "Cliente No Aparece"],
      ["driver_no_show", "Conductor No Aparece"],
      ["special_cases", "Casos Especiales"],
    ]),
    group("operator.notifications", null, "Notificaciones", "notificaciones", "/operator/notificaciones", "bell", 80, [
      ["send_message", "Enviar Mensaje"],
      ["sms", "SMS"],
      ["whatsapp", "WhatsApp"],
    ]),
  ].flat();

  await knex("admin_menu_items")
    .insert(menuItems)
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

  function item(code, parentCode, label, slug, path, icon, sortOrder) {
    const section = code.split(".").slice(0, 2).join(".");
    return {
      code,
      parent_code: parentCode,
      label,
      slug,
      path,
      icon,
      required_permission: `${section}.view`,
      sort_order: sortOrder,
      is_active: true,
    };
  }

  function group(code, parentCode, label, slug, path, icon, sortOrder, children) {
    return [
      item(code, parentCode, label, slug, path, icon, sortOrder),
      ...children.map(([childSlug, childLabel], index) =>
        item(
          `${code}.${childSlug}`,
          code,
          childLabel,
          childSlug.replaceAll("_", "-"),
          `${path}/${childSlug.replaceAll("_", "-")}`,
          null,
          (index + 1) * 10,
        ),
      ),
    ];
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex("admin_menu_items").whereLike("code", "operator.%").delete();
  await knex("admin_role_permissions").where({ role: "operator" }).delete();
  await knex("admin_permissions").whereLike("code", "operator.%").delete();

  await knex.schema.raw(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;
  `);

  await knex.schema.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'client', 'driver'));
  `);
};
