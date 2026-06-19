const bcrypt = require("bcryptjs");

const { TUNJA_CENTER } = require("../simulator/gps/tunja");

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
        profile: JSON.stringify({ preferences: { language: "en" } }),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      }
    )
    .returning(["id"]);

  await knex("clients").insert({
    user_id: clientUser.id,
    default_payment_method: "card",
    rating: 5,
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
    status: "online",
    current_location: knex.raw("ST_GeogFromText(?)", [
      `POINT(${TUNJA_CENTER.lng} ${TUNJA_CENTER.lat})`,
    ]),
    onboarded_at: knex.fn.now(),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  for (const serviceTypeCode of [
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
  ]) {
    await knex("driver_service_types").insert({
      driver_id: driverUser.id,
      service_type_code: serviceTypeCode,
      is_active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })
    .onConflict(["driver_id", "service_type_code"])
    .merge({ is_active: true, updated_at: knex.fn.now() });
  }

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

  const operators = [
    {
      email: "operator1@example.com",
      username: "operator1",
      first_name: "Laura",
      last_name: "Gómez",
      phone_number: "+573001000001",
      profile: {
        operator: {
          employeeCode: "OP-001",
          shift: "morning",
          operationZone: "Tunja Centro",
          specialties: ["ride_dispatch", "customer_support"],
        },
        preferences: { language: "es" },
      },
    },
    {
      email: "operator2@example.com",
      username: "operator2",
      first_name: "Diana",
      last_name: "Rodríguez",
      phone_number: "+573001000002",
      profile: {
        operator: {
          employeeCode: "OP-002",
          shift: "afternoon",
          operationZone: "Tunja Norte",
          specialties: ["ride_dispatch", "driver_support"],
        },
        preferences: { language: "es" },
      },
    },
    {
      email: "operator3@example.com",
      username: "operator3",
      first_name: "Marcela",
      last_name: "Pérez",
      phone_number: "+573001000003",
      profile: {
        operator: {
          employeeCode: "OP-003",
          shift: "night",
          operationZone: "Tunja Sur",
          specialties: ["incident_management", "driver_support"],
        },
        preferences: { language: "es" },
      },
    },
    {
      email: "operator4@example.com",
      username: "operator4",
      first_name: "Paola",
      last_name: "Martínez",
      phone_number: "+573001000004",
      profile: {
        operator: {
          employeeCode: "OP-004",
          shift: "morning",
          operationZone: "Tunja Oriente",
          specialties: ["customer_support", "incident_management"],
        },
        preferences: { language: "es" },
      },
    },
    {
      email: "operator5@example.com",
      username: "operator5",
      first_name: "Andrea",
      last_name: "Sánchez",
      phone_number: "+573001000005",
      profile: {
        operator: {
          employeeCode: "OP-005",
          shift: "afternoon",
          operationZone: "Tunja Occidente",
          specialties: ["ride_dispatch", "customer_support", "incident_management"],
        },
        preferences: { language: "es" },
      },
    },
  ];

  await knex("users").insert(
    operators.map((operator) => ({
      ...operator,
      password_hash: passwordHash,
      role: "operator",
      status: "active",
      email_verified: true,
      phone_verified: true,
      email_verification_token: null,
      email_verification_sent_at: null,
      phone_verification_token: null,
      phone_verification_sent_at: null,
      profile: JSON.stringify(operator.profile),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    }))
  );
};
