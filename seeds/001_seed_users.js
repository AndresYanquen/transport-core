const bcrypt = require("bcryptjs");

const DEFAULT_PASSWORD = "TestPassword123!";
const PASSWORD_SALT_ROUNDS = 12;

exports.seed = async function seed(knex) {
  const passwordHash = await bcrypt.hash(
    DEFAULT_PASSWORD,
    PASSWORD_SALT_ROUNDS
  );

  await knex("ride_events").del();
  await knex("rides").del();
  await knex("drivers").del();
  await knex("clients").del();
  await knex("users").del();

  const [clientUser] = await knex("users")
    .insert(
      {
        email: "client@example.com",
        username: "client",
        password_hash: passwordHash,
        first_name: "Clara",
        last_name: "Client",
        phone_number: "+10000000001",
        role: "client",
        status: "active",
        email_verified: true,
        phone_verified: true,
        email_verification_token: null,
        email_verification_sent_at: null,
        phone_verification_token: null,
        phone_verification_sent_at: null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      }
    )
    .returning(["id"]);

  await knex("clients").insert({
    user_id: clientUser.id,
    default_payment_method: "card",
    preferred_language: "en",
    rating: 5,
    total_trips: 42,
    preferences: JSON.stringify({ wheelchairAccessible: false }),
    home_location: knex.raw("ST_GeogFromText(?)", ["POINT(-74.0060 40.7128)"]),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  const [driverUser] = await knex("users")
    .insert(
      {
        email: "driver@example.com",
        username: "driver",
        password_hash: passwordHash,
        first_name: "Diego",
        last_name: "Driver",
        phone_number: "+10000000002",
        role: "driver",
        status: "active",
        email_verified: true,
        phone_verified: true,
        email_verification_token: null,
        email_verification_sent_at: null,
        phone_verification_token: null,
        phone_verification_sent_at: null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      }
    )
    .returning(["id"]);

  await knex("drivers").insert({
    user_id: driverUser.id,
    license_number: "DRV-123456",
    vehicle_make: "Toyota",
    vehicle_model: "Prius",
    vehicle_year: 2022,
    vehicle_color: "Black",
    vehicle_plate: "ABC-123",
    vehicle_type: "Sedan",
    documents: JSON.stringify({ insurance: true, registration: true }),
    rating: 4.9,
    total_trips: 318,
    status: "online",
    current_location: knex.raw("ST_GeogFromText(?)", ["POINT(-118.2437 34.0522)"]),
    onboarded_at: knex.fn.now(),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  await knex("users").insert({
    email: "admin@example.com",
    username: "admin",
    password_hash: passwordHash,
    first_name: "Ada",
    last_name: "Admin",
    phone_number: "+10000000003",
    role: "admin",
    status: "active",
    email_verified: true,
    phone_verified: true,
    email_verification_token: null,
    email_verification_sent_at: null,
    phone_verification_token: null,
    phone_verification_sent_at: null,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });
};
