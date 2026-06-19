/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("admin_permissions", (table) => {
    table.string("code", 120).primary();
    table.string("name", 120).notNullable();
    table.text("description");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(`
    ALTER TABLE admin_permissions
    ADD CONSTRAINT admin_permissions_code_not_blank_check
    CHECK (length(trim(code)) > 0);
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_admin_permissions_updated_at
    BEFORE UPDATE ON admin_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);

  await knex.schema.createTable("admin_role_permissions", (table) => {
    table.string("role", 50).notNullable();
    table
      .string("permission_code", 120)
      .notNullable()
      .references("code")
      .inTable("admin_permissions")
      .onUpdate("CASCADE")
      .onDelete("CASCADE");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.primary(["role", "permission_code"]);
    table.index(["permission_code"], "admin_role_permissions_permission_idx");
  });

  await knex.schema.createTable("admin_menu_items", (table) => {
    table.string("code", 120).primary();
    table
      .string("parent_code", 120)
      .references("code")
      .inTable("admin_menu_items")
      .onUpdate("CASCADE")
      .onDelete("CASCADE");
    table.string("label", 120).notNullable();
    table.string("slug", 80).notNullable();
    table.string("path", 255);
    table.string("icon", 80);
    table
      .string("required_permission", 120)
      .references("code")
      .inTable("admin_permissions")
      .onUpdate("CASCADE")
      .onDelete("RESTRICT");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["parent_code", "slug"], "admin_menu_items_parent_slug_unique");
    table.index(["parent_code", "sort_order"], "admin_menu_items_parent_sort_idx");
    table.index(["is_active", "sort_order"], "admin_menu_items_active_sort_idx");
    table.index(["required_permission"], "admin_menu_items_permission_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE admin_menu_items
    ADD CONSTRAINT admin_menu_items_code_not_blank_check
    CHECK (length(trim(code)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE admin_menu_items
    ADD CONSTRAINT admin_menu_items_label_not_blank_check
    CHECK (length(trim(label)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE admin_menu_items
    ADD CONSTRAINT admin_menu_items_slug_not_blank_check
    CHECK (length(trim(slug)) > 0);
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_admin_menu_items_updated_at
    BEFORE UPDATE ON admin_menu_items
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);

  const sections = [
    ["dashboard", "Dashboard", "layout-dashboard"],
    ["operation", "Operación", "radio-tower"],
    ["drivers", "Conductores", "car"],
    ["customers", "Clientes", "users"],
    ["services", "Servicios", "briefcase-business"],
    ["zones", "Zonas", "map"],
    ["reports", "Reportes", "chart-column"],
    ["operators", "Operadoras", "headset"],
    ["notifications", "Notificaciones", "bell"],
    ["security", "Seguridad", "shield-check"],
    ["settings", "Configuración", "settings"],
  ];

  const permissions = sections.map(([code, label]) => ({
    code: `admin.${code}.view`,
    name: `${label}: ver`,
    description: `Permite ver el módulo ${label} del panel administrativo.`,
  }));

  await knex("admin_permissions").insert(permissions);

  await knex("admin_role_permissions").insert(
    permissions.map((permission) => ({
      role: "admin",
      permission_code: permission.code,
    })),
  );

  const menuItems = [
    item("dashboard", null, "Dashboard", "dashboard", "/", "layout-dashboard", 10),
    item("dashboard.summary", "dashboard", "Resumen General", "resumen-general", "/admin/dashboard/resumen", null, 10),
    item("dashboard.realtime_map", "dashboard", "Mapa en Tiempo Real", "mapa-en-tiempo-real", "/admin/dashboard/mapa", null, 20),
    item("dashboard.metrics", "dashboard", "Métricas", "metricas", "/admin/dashboard/metricas", null, 30),
    item("dashboard.alerts", "dashboard", "Alertas", "alertas", "/admin/dashboard/alertas", null, 40),

    item("operation", null, "Operación", "operacion", "/admin/operacion", "radio-tower", 20),
    item("operation.requests", "operation", "Solicitudes", "solicitudes", "/admin/operacion/solicitudes", null, 10),
    item("operation.requests.all", "operation.requests", "Todas", "todas", "/admin/operacion/solicitudes/todas", null, 10),
    item("operation.requests.pending", "operation.requests", "Pendientes", "pendientes", "/admin/operacion/solicitudes/pendientes", null, 20),
    item("operation.requests.assigned", "operation.requests", "Asignadas", "asignadas", "/admin/operacion/solicitudes/asignadas", null, 30),
    item("operation.requests.in_progress", "operation.requests", "En Curso", "en-curso", "/admin/operacion/solicitudes/en-curso", null, 40),
    item("operation.requests.completed", "operation.requests", "Finalizadas", "finalizadas", "/admin/operacion/solicitudes/finalizadas", null, 50),
    item("operation.requests.canceled", "operation.requests", "Canceladas", "canceladas", "/admin/operacion/solicitudes/canceladas", null, 60),
    item("operation.assignments", "operation", "Asignaciones", "asignaciones", "/admin/operacion/asignaciones", null, 20),
    item("operation.assignments.manual", "operation.assignments", "Manuales", "manuales", "/admin/operacion/asignaciones/manuales", null, 10),
    item("operation.assignments.reassignments", "operation.assignments", "Reasignaciones", "reasignaciones", "/admin/operacion/asignaciones/reasignaciones", null, 20),
    item("operation.assignments.history", "operation.assignments", "Historial", "historial", "/admin/operacion/asignaciones/historial", null, 30),
    item("operation.monitoring", "operation", "Monitoreo", "monitoreo", "/admin/operacion/monitoreo", null, 30),
    item("operation.monitoring.active_rides", "operation.monitoring", "Viajes Activos", "viajes-activos", "/admin/operacion/monitoreo/viajes-activos", null, 10),
    item("operation.monitoring.online_drivers", "operation.monitoring", "Conductores Online", "conductores-online", "/admin/operacion/monitoreo/conductores-online", null, 20),
    item("operation.monitoring.active_customers", "operation.monitoring", "Clientes Activos", "clientes-activos", "/admin/operacion/monitoreo/clientes-activos", null, 30),
    item("operation.incidents", "operation", "Incidentes", "incidentes", "/admin/operacion/incidentes", null, 40),
    item("operation.incidents.reports", "operation.incidents", "Reportes", "reportes", "/admin/operacion/incidentes/reportes", null, 10),
    item("operation.incidents.complaints", "operation.incidents", "Quejas", "quejas", "/admin/operacion/incidentes/quejas", null, 20),
    item("operation.incidents.special_cases", "operation.incidents", "Casos Especiales", "casos-especiales", "/admin/operacion/incidentes/casos-especiales", null, 30),

    group("drivers", null, "Conductores", "conductores", "/admin/conductores", "car", 30, [
      ["list", "Listado"], ["approvals", "Aprobaciones"], ["documents", "Documentos"], ["vehicles", "Vehículos"], ["ratings", "Calificaciones"], ["suspensions", "Suspensiones"],
    ]),
    group("customers", null, "Clientes", "clientes", "/admin/clientes", "users", 40, [
      ["list", "Listado"], ["service_history", "Historial de Servicios"], ["ratings", "Calificaciones"], ["blocks", "Bloqueos"],
    ]),

    item("services", null, "Servicios", "servicios", "/admin/servicios", "briefcase-business", 50),
    serviceGroup("services.taxi", "Taxi", "taxi", 10),
    serviceGroup("services.trunk", "Baúl", "baul", 20),
    serviceGroup("services.delivery", "Domicilio", "domicilio", 30),
    serviceGroup("services.flat_tire", "Despinchada", "despinchada", 40),

    group("zones", null, "Zonas", "zonas", "/admin/zonas", "map", 60, [
      ["coverage_map", "Mapa de Cobertura"], ["operational_zones", "Zonas Operativas"], ["hot_zones", "Hot Zones"], ["zone_pricing", "Tarifas por Zona"],
    ]),
    group("reports", null, "Reportes", "reportes", "/admin/reportes", "chart-column", 70, [
      ["services", "Servicios"], ["drivers", "Conductores"], ["customers", "Clientes"], ["revenue", "Ingresos"], ["cancellations", "Cancelaciones"],
    ]),
    group("operators", null, "Operadoras", "operadoras", "/admin/operadoras", "headset", 80, [
      ["list", "Listado"], ["shifts", "Turnos"], ["activity", "Actividad"], ["permissions", "Permisos"],
    ]),
    group("notifications", null, "Notificaciones", "notificaciones", "/admin/notificaciones", "bell", 90, [
      ["push", "Push"], ["sms", "SMS"], ["whatsapp", "WhatsApp"], ["templates", "Plantillas"],
    ]),
    group("security", null, "Seguridad", "seguridad", "/admin/seguridad", "shield-check", 100, [
      ["users", "Usuarios"], ["roles", "Roles"], ["permissions", "Permisos"], ["audit", "Auditoría"],
    ]),
    group("settings", null, "Configuración", "configuracion", "/admin/configuracion", "settings", 110, [
      ["general", "General"], ["operational_parameters", "Parámetros Operativos"], ["integrations", "Integraciones"], ["geolocation", "Geolocalización"], ["logs", "Logs"],
    ]),
  ].flat();

  await knex("admin_menu_items").insert(menuItems);

  function item(code, parentCode, label, slug, path, icon, sortOrder) {
    const section = code.split(".")[0];
    return {
      code,
      parent_code: parentCode,
      label,
      slug,
      path,
      icon,
      required_permission: `admin.${section}.view`,
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

  function serviceGroup(code, label, slug, sortOrder) {
    const path = `/admin/servicios/${slug}`;
    return [
      item(code, "services", label, slug, path, null, sortOrder),
      item(`${code}.pricing`, code, "Tarifas", "tarifas", `${path}/tarifas`, null, 10),
      item(`${code}.configuration`, code, "Configuración", "configuracion", `${path}/configuracion`, null, 20),
    ];
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_admin_menu_items_updated_at ON admin_menu_items;
  `);
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_admin_permissions_updated_at ON admin_permissions;
  `);
  await knex.schema.dropTableIfExists("admin_menu_items");
  await knex.schema.dropTableIfExists("admin_role_permissions");
  await knex.schema.raw(`
    ALTER TABLE admin_permissions
    DROP CONSTRAINT IF EXISTS admin_permissions_code_not_blank_check;
  `);
  await knex.schema.dropTableIfExists("admin_permissions");
};
