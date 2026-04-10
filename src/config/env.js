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

function getDefaultCorsOrigins(nodeEnv) {
  // In production, require explicit CORS origins from env vars.
  if (nodeEnv === "production") {
    return [];
  }

  return [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
  ];
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function withTemporaryLocalhostCors(baseOrigins, nodeEnv, allowLocalhostTemporarily) {
  if (nodeEnv !== "production" || !allowLocalhostTemporarily) {
    return baseOrigins;
  }

  const localhostOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
  ];

  return [...new Set([...baseOrigins, ...localhostOrigins])];
}

const nodeEnv = process.env.NODE_ENV || "development";
const allowLocalhostCorsTemporarily = parseBoolean(
  process.env.CORS_ALLOW_LOCALHOST_TEMP,
  false
);

const parsedCorsOrigins = parseCsv(
  process.env.CORS_ALLOWED_ORIGINS,
  getDefaultCorsOrigins(nodeEnv)
);

const env = {
  nodeEnv,
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "postgres",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
  },
  cors: {
    allowedOrigins: withTemporaryLocalhostCors(
      parsedCorsOrigins,
      nodeEnv,
      allowLocalhostCorsTemporarily
    ),
    allowLocalhostTemporarily: allowLocalhostCorsTemporarily,
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || "dev-insecure-jwt-secret",
    jwtExpiresInSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS || 3600),
    jwtRememberMeExpiresInSeconds: Number(
      process.env.JWT_REMEMBER_ME_TTL_SECONDS || 2592000
    ),
  },
  realtime: {
    enabled: parseBoolean(process.env.SOCKET_ENABLED, true),
    path: process.env.SOCKET_PATH || "/socket.io",
  },
};

module.exports = { env };
