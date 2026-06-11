const { query } = require("../../../config/database");

class PreferencesModel {
  static async findUserPreferencesByUserId(userId) {
    const { rows } = await query(
      `
        SELECT COALESCE(profile -> 'preferences', '{}'::jsonb) AS preferences
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [userId]
    );

    return rows[0]?.preferences ?? null;
  }

  static async updateUserPreferences(userId, preferences) {
    const { rows } = await query(
      `
        UPDATE users
        SET profile = jsonb_set(
          COALESCE(profile, '{}'::jsonb),
          '{preferences}',
          $2::jsonb,
          true
        )
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING profile -> 'preferences' AS preferences
      `,
      [userId, JSON.stringify(preferences)]
    );

    return rows[0]?.preferences ?? null;
  }
}

module.exports = PreferencesModel;
