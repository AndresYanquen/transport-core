const test = require("node:test");
const assert = require("node:assert/strict");

const AdminNavigationService = require("../src/modules/admin-navigation/services/admin-navigation.service");
const database = require("../src/config/database");

test("favorites reject unavailable menu items", async () => {
  const originalQuery = database.query;
  database.query = async (sql) => {
    if (String(sql).includes("FROM admin_menu_items")) {
      return {
        rows: [
          {
            code: "dashboard",
            parent_code: null,
            label: "Dashboard",
            slug: "dashboard",
            path: "/admin/dashboard",
            icon: "layout-dashboard",
            required_permission: null,
            sort_order: 10,
          },
        ],
      };
    }
    return { rows: [] };
  };

  try {
    await assert.rejects(
      () => AdminNavigationService.updateFavoritesForUser(
        { id: "user-1", role: "admin" },
        { rootPrefix: "admin", favoriteCodes: ["operator.dashboard"] },
      ),
      (error) => error.status === 400 && /not available/.test(error.message),
    );
  } finally {
    database.query = originalQuery;
  }
});
