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

  static async upsert({ key, value, description }) {
    const { rows } = await query(
      `
        INSERT INTO config_settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key)
        DO UPDATE SET
          value = EXCLUDED.value,
          description = COALESCE(EXCLUDED.description, config_settings.description),
          updated_at = NOW()
        RETURNING key, value, description, created_at, updated_at
      `,
      [key, value, description ?? null]
    );

    return mapSettingRow(rows[0]);
  }
}

module.exports = SettingsModel;
