const { env } = require("./env");

function validateProductionEnv() {
  if (env.nodeEnv !== "production") {
    return;
  }

  const missing = [];

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "dev-insecure-jwt-secret") {
    missing.push("JWT_SECRET");
  }

  if (!process.env.DB_HOST) missing.push("DB_HOST");
  if (!process.env.DB_NAME) missing.push("DB_NAME");
  if (!process.env.DB_USER) missing.push("DB_USER");
  if (!process.env.DB_PASSWORD) missing.push("DB_PASSWORD");
  if (!process.env.CORS_ALLOWED_ORIGINS) missing.push("CORS_ALLOWED_ORIGINS");

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
