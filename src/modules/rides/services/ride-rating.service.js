const RideModel = require("../models/ride.model");
const RideRatingModel = require("../models/ride-rating.model");
const { RideStatus } = require("../constants/ride-status");
const { pool } = require("../../../config/database");

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeTags(tags) {
  if (tags === undefined || tags === null) {
    return [];
  }
  if (!Array.isArray(tags)) {
    throw createHttpError(400, "tags must be an array of strings when provided.");
  }

  const normalized = tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 20);

  return [...new Set(normalized)];
}

async function updateAggregateForRatee(dbClient, { rateeUserId, rateeRole }) {
  const table = rateeRole === "driver" ? "drivers" : "clients";

  const { rows } = await dbClient.query(
    `
      SELECT user_id
      FROM ${table}
      WHERE user_id = $1
      FOR UPDATE
    `,
    [rateeUserId]
  );

  if (!rows[0]) {
    // If profile is missing, do not fail rating creation.
    return;
  }

  const { rows: avgRows } = await dbClient.query(
    `
      SELECT AVG(stars)::double precision AS avg_stars
      FROM ride_ratings
      WHERE ratee_user_id = $1
    `,
    [rateeUserId]
  );

  const avg = avgRows[0]?.avg_stars;
  const nextRating = avg !== null && avg !== undefined ? Number(avg) : 0;

  await dbClient.query(
    `
      UPDATE ${table}
      SET rating = $2,
          updated_at = NOW()
      WHERE user_id = $1
    `,
    [rateeUserId, nextRating]
  );
}

function determineRatee({ rideRow, raterRole, raterUserId }) {
  if (!rideRow) {
    throw createHttpError(404, "Ride not found.");
  }

  if (rideRow.status !== RideStatus.COMPLETED) {
    throw createHttpError(409, "Ride must be completed before it can be rated.");
  }

  if (raterRole === "client") {
    if (rideRow.client_id !== raterUserId) {
      throw createHttpError(403, "Clients may only rate their own rides.");
    }
    if (!rideRow.driver_id) {
      throw createHttpError(409, "Ride has no driver to rate.");
    }
    return { rateeUserId: rideRow.driver_id, rateeRole: "driver" };
  }

  if (raterRole === "driver") {
    if (rideRow.driver_id !== raterUserId) {
      throw createHttpError(403, "Drivers may only rate rides assigned to them.");
    }
    return { rateeUserId: rideRow.client_id, rateeRole: "client" };
  }

  throw createHttpError(403, "Only client and driver roles may rate rides.");
}

async function rateRide({ rideId, stars, comment, tags }, viewer) {
  if (!viewer?.id) {
    throw createHttpError(401, "Unauthorized");
  }

  const raterRole = String(viewer.role || "").toLowerCase();

  const parsedStars = Number(stars);
  if (!Number.isInteger(parsedStars) || parsedStars < 1 || parsedStars > 5) {
    throw createHttpError(400, "stars must be an integer between 1 and 5.");
  }

  if (comment !== undefined && comment !== null && typeof comment !== "string") {
    throw createHttpError(400, "comment must be a string when provided.");
  }

  const normalizedComment = typeof comment === "string" ? comment.trim().slice(0, 2000) : null;
  const normalizedTags = normalizeTags(tags);

  const dbClient = await pool.connect();
  let committed = false;
  try {
    await dbClient.query("BEGIN");

    const rideRow = await RideModel.getRideByIdForUpdate(rideId, dbClient);
    const { rateeUserId, rateeRole } = determineRatee({
      rideRow,
      raterRole,
      raterUserId: viewer.id,
    });

    let rating;
    try {
      rating = await RideRatingModel.createRating(
        {
          rideId,
          raterUserId: viewer.id,
          rateeUserId,
          stars: parsedStars,
          comment: normalizedComment,
          tags: normalizedTags,
        },
        dbClient
      );
    } catch (error) {
      if (error.code === "23505") {
        throw createHttpError(409, "You have already rated this ride.");
      }
      throw error;
    }

    await updateAggregateForRatee(dbClient, { rateeUserId, rateeRole });

    await dbClient.query("COMMIT");
    committed = true;

    return {
      rating,
    };
  } catch (error) {
    if (!committed) {
      await dbClient.query("ROLLBACK");
    }
    throw error;
  } finally {
    dbClient.release();
  }
}

async function getMyRating({ rideId }, viewer) {
  if (!viewer?.id) {
    throw createHttpError(401, "Unauthorized");
  }
  return RideRatingModel.getMyRatingForRide({
    rideId,
    raterUserId: viewer.id,
  });
}

async function listRatings({ rideId }, viewer) {
  if (!viewer?.id) {
    throw createHttpError(401, "Unauthorized");
  }
  return RideRatingModel.listRatingsForRide({ rideId });
}

module.exports = {
  rateRide,
  getMyRating,
  listRatings,
  __private: {
    normalizeTags,
    determineRatee,
    updateAggregateForRatee,
  },
};
