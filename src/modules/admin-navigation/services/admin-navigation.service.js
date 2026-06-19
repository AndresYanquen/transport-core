const { query } = require("../../../config/database");

function toMenuNode(row) {
  return {
    code: row.code,
    parentCode: row.parent_code,
    label: row.label,
    slug: row.slug,
    path: row.path,
    icon: row.icon,
    requiredPermission: row.required_permission,
    sortOrder: row.sort_order,
    children: [],
  };
}

function buildTree(rows) {
  const nodes = new Map();
  const roots = [];

  for (const row of rows) {
    nodes.set(row.code, toMenuNode(row));
  }

  for (const node of nodes.values()) {
    if (node.parentCode && nodes.has(node.parentCode)) {
      nodes.get(node.parentCode).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function getMenuForUser(user, { rootPrefix = "admin" } = {}) {
  const role = String(user?.role || "").toLowerCase();
  const prefix = String(rootPrefix || "").trim();
  const rootFilter =
    prefix === "operator"
      ? "m.code LIKE $2"
      : "m.code NOT LIKE 'operator.%'";
  const values = prefix === "operator" ? [role, `${prefix}.%`] : [role];

  const { rows } = await query(
    `
      SELECT
        m.code,
        m.parent_code,
        m.label,
        m.slug,
        m.path,
        m.icon,
        m.required_permission,
        m.sort_order
      FROM admin_menu_items m
      WHERE m.is_active = true
        AND ${rootFilter}
        AND (
          m.required_permission IS NULL
          OR EXISTS (
            SELECT 1
            FROM admin_role_permissions rp
            WHERE rp.role = $1
              AND rp.permission_code = m.required_permission
          )
        )
      ORDER BY
        COALESCE(m.parent_code, ''),
        m.sort_order ASC,
        m.label ASC
    `,
    values,
  );

  return {
    items: buildTree(rows || []),
  };
}

module.exports = {
  getMenuForUser,
};
