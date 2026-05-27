const { query } = require("../../../config/database");

const BASE_FIELDS = `
  id,
  ride_id,
  rater_user_id,
  ratee_user_id,
  stars,
  comment,
  tags,
  created_at
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    rideId: row.ride_id,
    raterUserId: row.rater_user_id,
    rateeUserId: row.ratee_user_id,
    stars: Number(row.stars),
    comment: row.comment,
    tags: row.tags ?? [],
    ratedAt: row.created_at,
  };
}

class RideRatingModel {
  static async createRating({
    rideId,
    raterUserId,
    rateeUserId,
    stars,
    comment,
    tags,
  }, dbClient = null) {
    const executor = dbClient ?? { query: (text, params) => query(text, params) };

    const { rows } = await executor.query(
      `
        INSERT INTO ride_ratings (
          ride_id,
          rater_user_id,
          ratee_user_id,
          stars,
          comment,
          tags
        )
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::jsonb, '[]'::jsonb))
        RETURNING ${BASE_FIELDS}
      `,
      [
        rideId,
        raterUserId,
        rateeUserId,
        stars,
        comment ?? null,
        tags ? JSON.stringify(tags) : null,
      ]
    );

    return mapRow(rows[0]);
  }

  static async getMyRatingForRide({ rideId, raterUserId }) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM ride_ratings
        WHERE ride_id = $1
          AND rater_user_id = $2
        LIMIT 1
      `,
      [rideId, raterUserId]
    );
    return mapRow(rows[0]);
  }

  static async listRatingsForRide({ rideId }) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM ride_ratings
        WHERE ride_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [rideId]
    );
    return rows.map(mapRow);
  }
}

module.exports = RideRatingModel;

