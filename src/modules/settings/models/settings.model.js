const { query } = require("../../../config/database");

function mapSettingRow(row) {
  if (!row) {
    return null;
  }

  return {
    key: row.key,
    value: row.value,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SettingsModel {
  static async findByKey(key) {
    const { rows } = await query(
      `
        SELECT key, value, description, created_at, updated_at
        FROM config_settings
        WHERE key = $1
      `,
      [key]
    );

    return mapSettingRow(rows[0]);
  }
}

module.exports = SettingsModel;
