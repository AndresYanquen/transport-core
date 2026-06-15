const bcrypt = require("bcryptjs");
const knex = require("knex");

const knexConfig = require("../../knexfile");

const PASSWORD_SALT_ROUNDS = 12;

function driverEmail(n) {
  return `driver${n}@test.com`;
}

function customerEmail(n) {
  return `customer${n}@test.com`;
}

async function ensureSimulationUsers({
  driverCount,
  customerCount,
  password,
  nodeEnv = process.env.NODE_ENV || "development",
  logger,
}) {
  const db = knex(knexConfig[nodeEnv] || knexConfig.development);
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

  try {
    await db.transaction(async (trx) => {
      for (let n = 1; n <= driverCount; n += 1) {
        await ensureDriver(trx, n, passwordHash);
      }

      for (let n = 1; n <= customerCount; n += 1) {
        await ensureCustomer(trx, n, passwordHash);
      }
    });
    logger?.info?.(
      `[SIMULATOR] ensured simulation users drivers=${driverCount} customers=${customerCount}`
    );
  } finally {
    await db.destroy();
  }
}

async function ensureDriver(trx, n, passwordHash) {
  const email = driverEmail(n);
  const existing = await trx("users").select("id").where({ email }).first();

  let userId = existing?.id;
  if (!userId) {
    const [row] = await trx("users")
      .insert({
        email,
        username: `driver${n}`,
        password_hash: passwordHash,
        first_name: `Driver${n}`,
        last_name: "Sim",
        phone_number: `+1999${String(n).padStart(7, "0")}`,
        role: "driver",
        status: "active",
        email_verified: true,
        phone_verified: true,
        profile: JSON.stringify({ preferences: { language: "en" } }),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning(["id"]);
    userId = row.id;
  } else {
    await trx("users")
      .where({ id: userId })
      .update({
        password_hash: passwordHash,
        role: "driver",
        status: "active",
        email_verified: true,
        phone_verified: true,
        updated_at: trx.fn.now(),
      });
  }

  const driverProfile = await trx("drivers").select("user_id").where({ user_id: userId }).first();
  if (!driverProfile) {
    await trx("drivers").insert({
      user_id: userId,
      license_number: `SIM-DRV-${String(n).padStart(6, "0")}`,
      vehicle_make: "Toyota",
      vehicle_model: "Corolla",
      vehicle_year: 2021,
      vehicle_color: "Gray",
      vehicle_plate: `SIM-${String(n).padStart(4, "0")}`,
      vehicle_type: "Sedan",
      documents: JSON.stringify({ sim: true }),
      rating: 0,
      status: "offline",
      current_location: null,
      onboarded_at: trx.fn.now(),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
  }

  await trx("driver_service_types")
    .insert({
      driver_id: userId,
      service_type_code: "standard",
      is_active: true,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .onConflict(["driver_id", "service_type_code"])
    .merge({ is_active: true, updated_at: trx.fn.now() });
}

async function ensureCustomer(trx, n, passwordHash) {
  const email = customerEmail(n);
  const existing = await trx("users").select("id").where({ email }).first();

  let userId = existing?.id;
  if (!userId) {
    const [row] = await trx("users")
      .insert({
        email,
        username: `customer${n}`,
        password_hash: passwordHash,
        first_name: `Customer${n}`,
        last_name: "Sim",
        phone_number: `+1888${String(n).padStart(7, "0")}`,
        role: "client",
        status: "active",
        email_verified: true,
        phone_verified: true,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning(["id"]);
    userId = row.id;
  } else {
    await trx("users")
      .where({ id: userId })
      .update({
        password_hash: passwordHash,
        role: "client",
        status: "active",
        email_verified: true,
        phone_verified: true,
        updated_at: trx.fn.now(),
      });
  }

  const clientProfile = await trx("clients").select("user_id").where({ user_id: userId }).first();
  if (!clientProfile) {
    await trx("clients").insert({
      user_id: userId,
      default_payment_method: null,
      rating: 0,
      home_location: null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
  }
}

module.exports = {
  ensureSimulationUsers,
};
