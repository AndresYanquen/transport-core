require("dotenv").config();

const knex = require("knex");
const knexConfig = require("../knexfile");

const nodeEnv = process.env.NODE_ENV || "development";
const dryRun = isTruthy(process.env.SIM_CLEANUP_DRY_RUN);
const allowProduction = isTruthy(process.env.SIM_CLEANUP_ALLOW_PRODUCTION);
const config = knexConfig[nodeEnv] || knexConfig.development;
const db = knex(config);

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function simDriverEmailQuery(qb) {
  qb.whereRaw("email ~* ?", ["^driver[0-9]+@test\\.com$"]);
}

function simCustomerEmailQuery(qb) {
  qb.whereRaw("email ~* ?", ["^customer[0-9]+@test\\.com$"]);
}

function simUserEmailQuery(qb) {
  qb.where(simDriverEmailQuery).orWhere(simCustomerEmailQuery);
}

async function countRows(trx) {
  const [users, drivers, clients, rides, invites, events, ratings] = await Promise.all([
    trx("users").where(simUserEmailQuery).count({ count: "*" }).first(),
    trx("drivers")
      .join("users", "users.id", "drivers.user_id")
      .where(simDriverEmailQuery)
      .count({ count: "*" })
      .first(),
    trx("clients")
      .join("users", "users.id", "clients.user_id")
      .where(simCustomerEmailQuery)
      .count({ count: "*" })
      .first(),
    simulationRides(trx).count({ count: "*" }).first(),
    trx("ride_driver_invites")
      .whereIn("ride_id", simulationRides(trx).select("rides.id"))
      .count({ count: "*" })
      .first(),
    trx("ride_events")
      .whereIn("ride_id", simulationRides(trx).select("rides.id"))
      .count({ count: "*" })
      .first(),
    trx("ride_ratings")
      .whereIn("ride_id", simulationRides(trx).select("rides.id"))
      .count({ count: "*" })
      .first(),
  ]);

  return {
    users: toCount(users),
    drivers: toCount(drivers),
    clients: toCount(clients),
    rides: toCount(rides),
    rideDriverInvites: toCount(invites),
    rideEvents: toCount(events),
    rideRatings: toCount(ratings),
  };
}

function toCount(row) {
  return Number(row?.count || 0);
}

function simulationRides(trx) {
  return trx("rides")
    .join("users as clients", "clients.id", "rides.client_id")
    .leftJoin("users as drivers", "drivers.id", "rides.driver_id")
    .where((qb) => {
      qb.whereRaw("clients.email ~* ?", ["^customer[0-9]+@test\\.com$"]).orWhereRaw(
        "drivers.email ~* ?",
        ["^driver[0-9]+@test\\.com$"]
      );
    });
}

async function cleanup(trx) {
  const rideIds = trx.select("id").from(simulationRides(trx).select("rides.id").as("simulation_rides"));
  const simUserIds = trx("users").where(simUserEmailQuery).select("id");

  const deletedRatings = await trx("ride_ratings").whereIn("ride_id", rideIds).del();
  const deletedInvites = await trx("ride_driver_invites").whereIn("ride_id", rideIds).del();
  const deletedEvents = await trx("ride_events").whereIn("ride_id", rideIds).del();
  const deletedRides = await trx("rides").whereIn("id", rideIds).del();
  const deletedDrivers = await trx("drivers").whereIn("user_id", simUserIds).del();
  const deletedClients = await trx("clients").whereIn("user_id", simUserIds).del();
  const deletedUsers = await trx("users").whereIn("id", simUserIds).del();

  return {
    users: deletedUsers,
    drivers: deletedDrivers,
    clients: deletedClients,
    rides: deletedRides,
    rideDriverInvites: deletedInvites,
    rideEvents: deletedEvents,
    rideRatings: deletedRatings,
  };
}

async function main() {
  if (nodeEnv === "production" && !allowProduction) {
    throw new Error(
      "Refusing to cleanup simulator data in production. Set SIM_CLEANUP_ALLOW_PRODUCTION=true to override."
    );
  }

  await db.transaction(async (trx) => {
    const before = await countRows(trx);

    if (dryRun) {
      console.log("[SIM_CLEANUP] dry run only. Matching rows:");
      console.log(JSON.stringify(before, null, 2));
      return;
    }

    const deleted = await cleanup(trx);
    const after = await countRows(trx);

    console.log("[SIM_CLEANUP] deleted rows:");
    console.log(JSON.stringify(deleted, null, 2));
    console.log("[SIM_CLEANUP] remaining matching rows:");
    console.log(JSON.stringify(after, null, 2));
  });
}

main()
  .catch((err) => {
    console.error("[SIM_CLEANUP] failed:", err?.message || err);
    if (err?.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
