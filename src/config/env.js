const dotenv = require("dotenv");

dotenv.config();

function parseCsv(value, fallback = []) {
  if (!value) {
    return [...fallback];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const defaultCorsOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:5173",
];

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "postgres",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
  },
  cors: {
    allowedOrigins: parseCsv(
      process.env.CORS_ALLOWED_ORIGINS,
      defaultCorsOrigins
    ),
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || "dev-insecure-jwt-secret",
    jwtExpiresInSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS || 3600),
  },
};

module.exports = { env };
