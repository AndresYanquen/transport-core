const database = require("../../../config/database");

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

function flattenMenu(items = []) {
  const flat = [];
  const visit = (item) => {
    flat.push({ ...item, children: [] });
    (item.children || []).forEach(visit);
  };
  items.forEach(visit);
  return flat;
}

async function getMenuForUser(user, { rootPrefix = "admin" } = {}) {
  const role = String(user?.role || "").toLowerCase();
  const prefix = String(rootPrefix || "").trim();
  const rootFilter =
    prefix === "operator"
      ? "m.code LIKE $2"
      : "m.code NOT LIKE 'operator.%'";
  const values = prefix === "operator" ? [role, `${prefix}.%`] : [role];

  const { rows } = await database.query(
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

async function getFavoritesForUser(user, { rootPrefix = "admin" } = {}) {
  const menu = await getMenuForUser(user, { rootPrefix });
  const allowedItems = flattenMenu(menu.items).filter((item) => item.path);
  const allowedByCode = new Map(allowedItems.map((item) => [item.code, item]));
  const codes = [...allowedByCode.keys()];

  if (!codes.length) {
    return { favorites: [], availableItems: [] };
  }

  const { rows } = await database.query(
    `
      SELECT menu_item_code, sort_order
      FROM user_menu_favorites
      WHERE user_id = $1
        AND menu_item_code = ANY($2::text[])
      ORDER BY sort_order ASC, created_at ASC
    `,
    [user.id, codes],
  );

  const favorites = rows
    .map((row) => allowedByCode.get(row.menu_item_code))
    .filter(Boolean);

  return {
    favorites,
    availableItems: allowedItems,
  };
}

async function updateFavoritesForUser(user, { rootPrefix = "admin", favoriteCodes = [] } = {}) {
  const menu = await getMenuForUser(user, { rootPrefix });
  const allowedCodes = new Set(flattenMenu(menu.items).filter((item) => item.path).map((item) => item.code));
  const uniqueCodes = [...new Set(favoriteCodes.map((code) => String(code || "").trim()).filter(Boolean))];

  if (uniqueCodes.some((code) => !allowedCodes.has(code))) {
    const error = new Error("Favorite menu item is not available for this user.");
    error.status = 400;
    throw error;
  }

  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_menu_favorites WHERE user_id = $1", [user.id]);
    if (uniqueCodes.length) {
      const values = uniqueCodes
        .map((_, index) => `($1, $${index + 2}, ${index + 1})`)
        .join(", ");
      await client.query(
        `
          INSERT INTO user_menu_favorites(user_id, menu_item_code, sort_order)
          VALUES ${values}
        `,
        [user.id, ...uniqueCodes],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getFavoritesForUser(user, { rootPrefix });
}

module.exports = {
  getMenuForUser,
  getFavoritesForUser,
  updateFavoritesForUser,
};
