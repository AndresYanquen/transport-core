const bcrypt = require("bcryptjs");

const DEFAULT_PASSWORD = process.env.SIM_USER_PASSWORD || "123456";
const PASSWORD_SALT_ROUNDS = 12;

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function driverEmail(n) {
  return `driver${n}@test.com`;
}

function customerEmail(n) {
  return `customer${n}@test.com`;
}

exports.seed = async function seed(knex) {
  const driverCount = toNumber(process.env.DRIVER_COUNT, 100);
  const customerCount = toNumber(process.env.CUSTOMER_COUNT, 500);

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, PASSWORD_SALT_ROUNDS);

  await knex.transaction(async (trx) => {
    // Drivers
    for (let n = 1; n <= driverCount; n += 1) {
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
            email_verification_token: null,
            email_verification_sent_at: null,
            phone_verification_token: null,
            phone_verification_sent_at: null,
            profile: JSON.stringify({ preferences: { language: "en" } }),
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning(["id"]);
        userId = row.id;
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
          service_type_code: "standard",
          documents: JSON.stringify({ sim: true }),
          rating: 0,
          status: "offline",
          current_location: null,
          onboarded_at: trx.fn.now(),
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      }
    }

    // Customers (clients)
    for (let n = 1; n <= customerCount; n += 1) {
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
            email_verification_token: null,
            email_verification_sent_at: null,
            phone_verification_token: null,
            phone_verification_sent_at: null,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning(["id"]);
        userId = row.id;
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
  });
};
