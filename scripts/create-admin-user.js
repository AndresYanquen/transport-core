require("dotenv").config();

const bcrypt = require("bcryptjs");

const { pool } = require("../src/config/database");

const PASSWORD_SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required.`);
  }

  return String(value).trim();
}

function optionalEnv(name, fallback = null) {
  const value = process.env[name];
  if (value === undefined || value === null || !String(value).trim()) {
    return fallback;
  }

  return String(value).trim();
}

async function main() {
  const email = requiredEnv("ADMIN_EMAIL").toLowerCase();
  const password = requiredEnv("ADMIN_PASSWORD");
  const username = optionalEnv("ADMIN_USERNAME", "admin").toLowerCase();
  const firstName = optionalEnv("ADMIN_FIRST_NAME", "Admin");
  const lastName = optionalEnv("ADMIN_LAST_NAME", "User");
  const phoneNumber = optionalEnv("ADMIN_PHONE_NUMBER");

  if (!email.includes("@")) {
    throw new Error("ADMIN_EMAIL must be a valid email.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long.`
    );
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

  const { rows } = await pool.query(
    `
      INSERT INTO users (
        email,
        username,
        password_hash,
        first_name,
        last_name,
        phone_number,
        role,
        status,
        email_verified,
        phone_verified,
        email_verification_token,
        email_verification_sent_at,
        phone_verification_token,
        phone_verification_sent_at,
        profile
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        'admin',
        'active',
        true,
        $7,
        NULL,
        NULL,
        NULL,
        NULL,
        $8::jsonb
      )
      ON CONFLICT (LOWER(email))
      WHERE email IS NOT NULL AND deleted_at IS NULL
      DO UPDATE SET
        username = EXCLUDED.username,
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone_number = EXCLUDED.phone_number,
        role = 'admin',
        status = 'active',
        email_verified = true,
        phone_verified = EXCLUDED.phone_verified,
        email_verification_token = NULL,
        email_verification_sent_at = NULL,
        phone_verification_token = NULL,
        phone_verification_sent_at = NULL,
        profile = EXCLUDED.profile,
        deleted_at = NULL,
        updated_at = NOW()
      RETURNING id, email, username, role, status
    `,
    [
      email,
      username,
      passwordHash,
      firstName,
      lastName,
      phoneNumber,
      Boolean(phoneNumber),
      JSON.stringify({ preferences: { language: "es" } }),
    ]
  );

  console.log("Admin user ready:");
  console.log(JSON.stringify(rows[0], null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
