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

function demoDriverState(n) {
  const clusters = [
    { lat: 40.7128, lng: -74.0060 },
    { lat: 4.711, lng: -74.0721 },
    { lat: 5.535, lng: -73.367 },
    { lat: 6.12345, lng: -74.12345 },
  ];

  if (n > 24) {
    return {
      status: "offline",
      location: null,
    };
  }

  const cluster = clusters[(n - 1) % clusters.length];
  const offset = Math.floor((n - 1) / clusters.length) * 0.0001;

  return {
    status: "online",
    location: {
      lat: cluster.lat + offset,
      lng: cluster.lng + offset,
    },
  };
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
      const demoState = demoDriverState(n);
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
          status: demoState.status,
          current_location: demoState.location
            ? trx.raw("ST_GeogFromText(?)", [
                `POINT(${demoState.location.lng} ${demoState.location.lat})`,
              ])
            : null,
          onboarded_at: trx.fn.now(),
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      } else {
        await trx("drivers")
          .where({ user_id: userId })
          .update({
            status: demoState.status,
            current_location: demoState.location
              ? trx.raw("ST_GeogFromText(?)", [
                  `POINT(${demoState.location.lng} ${demoState.location.lat})`,
                ])
              : null,
            updated_at: trx.fn.now(),
          });
      }

      const serviceTypeCodes =
        n <= 24
          ? [
              "standard",
              "premium",
              "pool",
              "xl",
              "deliver",
              "package_delivery",
              "food_delivery",
              "car_unstuck",
              "jump_start",
              "tire_change",
            ]
          : ["standard"];

      for (const serviceTypeCode of serviceTypeCodes) {
        await trx("driver_service_types").insert({
          driver_id: userId,
          service_type_code: serviceTypeCode,
          is_active: true,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .onConflict(["driver_id", "service_type_code"])
        .merge({ is_active: true, updated_at: trx.fn.now() });
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
