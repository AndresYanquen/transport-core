const { env } = require("./env");

function validateProductionEnv() {
  if (env.nodeEnv !== "production") {
    return;
  }

  const missing = [];

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "dev-insecure-jwt-secret") {
    missing.push("JWT_SECRET");
  }

  if (!process.env.DATABASE_URL) {
    if (!process.env.DB_HOST) missing.push("DB_HOST");
    if (!process.env.DB_NAME) missing.push("DB_NAME");
    if (!process.env.DB_USER) missing.push("DB_USER");
    if (!process.env.DB_PASSWORD) missing.push("DB_PASSWORD");
  }
  if (!process.env.CORS_ALLOWED_ORIGINS) missing.push("CORS_ALLOWED_ORIGINS");
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.APP_PUBLIC_URL) missing.push("APP_PUBLIC_URL");
  if (!process.env.MAIL_HOST) missing.push("MAIL_HOST");
  if (!process.env.MAIL_USER) missing.push("MAIL_USER");
  if (!process.env.MAIL_PASSWORD) missing.push("MAIL_PASSWORD");
  if (!process.env.MAIL_FROM) missing.push("MAIL_FROM");

  if (env.cors.allowedOrigins.includes("*")) {
    missing.push("CORS_ALLOWED_ORIGINS must not be * in production");
  }

  if (missing.length) {
    throw new Error(`Invalid production environment: ${missing.join(", ")}`);
  }
}

module.exports = {
  validateProductionEnv,
};
