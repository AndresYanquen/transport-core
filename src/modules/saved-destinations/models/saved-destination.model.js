const { query } = require("../../../config/database");

const BASE_FIELDS = `
  id,
  user_id,
  label,
  place_name,
  formatted_address,
  place_id,
  ST_AsGeoJSON(location)::jsonb AS location_geojson,
  usage_count,
  last_used_at,
  created_at,
  updated_at,
  deleted_at
`;

function parseGeoJson(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function toSavedDestination(row) {
  if (!row) {
    return null;
  }

  const geojson = parseGeoJson(row.location_geojson);
  const [lng = null, lat = null] = geojson?.coordinates || [];

  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    placeName: row.place_name,
    formattedAddress: row.formatted_address,
    placeId: row.place_id,
    location: lat !== null && lng !== null ? { lat, lng } : null,
    center: lng !== null && lat !== null ? [lng, lat] : null,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SavedDestinationModel {
  static async listByUserId(userId, { limit = 25, queryText = null } = {}) {
    const params = [userId, limit];
    const searchFilter = queryText
      ? `
        AND (
          label ILIKE $3
          OR place_name ILIKE $3
          OR formatted_address ILIKE $3
        )
      `
      : "";

    if (queryText) {
      params.push(`%${queryText}%`);
    }

    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM user_saved_destinations
        WHERE user_id = $1
          AND deleted_at IS NULL
          ${searchFilter}
        ORDER BY
          usage_count DESC,
          last_used_at DESC NULLS LAST,
          created_at DESC
        LIMIT $2
      `,
      params
    );

    return rows.map(toSavedDestination);
  }

  static async findByIdForUser(userId, destinationId) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM user_saved_destinations
        WHERE id = $1
          AND user_id = $2
          AND deleted_at IS NULL
      `,
      [destinationId, userId]
    );

    return toSavedDestination(rows[0]);
  }

  static async createForUser(userId, destination) {
    const { rows } = await query(
      `
        INSERT INTO user_saved_destinations (
          user_id,
          label,
          place_name,
          formatted_address,
          place_id,
          location
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography
        )
        RETURNING ${BASE_FIELDS}
      `,
      [
        userId,
        destination.label,
        destination.placeName,
        destination.formattedAddress,
        destination.placeId,
        destination.lng,
        destination.lat,
      ]
    );

    return toSavedDestination(rows[0]);
  }

  static async updateForUser(userId, destinationId, destination) {
    const { rows } = await query(
      `
        UPDATE user_saved_destinations
        SET
          label = COALESCE($3, label),
          place_name = COALESCE($4, place_name),
          formatted_address = CASE WHEN $5::boolean THEN $6 ELSE formatted_address END,
          place_id = CASE WHEN $7::boolean THEN $8 ELSE place_id END,
          location = CASE
            WHEN $9::boolean
            THEN ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography
            ELSE location
          END
        WHERE id = $1
          AND user_id = $2
          AND deleted_at IS NULL
        RETURNING ${BASE_FIELDS}
      `,
      [
        destinationId,
        userId,
        destination.label ?? null,
        destination.placeName ?? null,
        destination.hasFormattedAddress,
        destination.formattedAddress ?? null,
        destination.hasPlaceId,
        destination.placeId ?? null,
        destination.hasLocation,
        destination.lng ?? null,
        destination.lat ?? null,
      ]
    );

    return toSavedDestination(rows[0]);
  }

  static async markUsedForUser(userId, destinationId) {
    const { rows } = await query(
      `
        UPDATE user_saved_destinations
        SET
          usage_count = usage_count + 1,
          last_used_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND deleted_at IS NULL
        RETURNING ${BASE_FIELDS}
      `,
      [destinationId, userId]
    );

    return toSavedDestination(rows[0]);
  }

  static async softDeleteForUser(userId, destinationId) {
    const { rows } = await query(
      `
        UPDATE user_saved_destinations
        SET deleted_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [destinationId, userId]
    );

    return Boolean(rows[0]);
  }
}

module.exports = SavedDestinationModel;
