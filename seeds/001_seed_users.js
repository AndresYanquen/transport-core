const bcrypt = require("bcryptjs");

const DEFAULT_PASSWORD = "TestPassword123!";
const PASSWORD_SALT_ROUNDS = 12;

exports.seed = async function seed(knex) {
  const passwordHash = await bcrypt.hash(
    DEFAULT_PASSWORD,
    PASSWORD_SALT_ROUNDS
  );

  await knex("users").del();

  await knex("users").insert([
    {
      email: "demo@example.com",
      username: "demo",
      password_hash: passwordHash,
      first_name: "Demo",
      last_name: "User",
      phone_number: "+10000000000",
      role: "admin",
      status: "active",
      email_verified: true,
      phone_verified: false,
      email_verification_token: null,
      email_verification_sent_at: null,
      phone_verification_token: null,
      phone_verification_sent_at: null,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    },
  ]);
};
