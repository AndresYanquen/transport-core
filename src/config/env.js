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

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  port: parseNumber(process.env.PORT, 3000),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseNumber(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME || "postgres",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    ssl: parseBoolean(process.env.DB_SSL, false),
    rejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, false),
    connectionTimeoutMillis: parseNumber(process.env.DB_CONNECTION_TIMEOUT_MS, 5000),
    idleTimeoutMillis: parseNumber(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    poolMax: parseNumber(process.env.DB_POOL_MAX, 10),
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
    jwtExpiresInSeconds: parseNumber(process.env.JWT_ACCESS_TTL_SECONDS, 3600),
    jwtRememberMeExpiresInSeconds: parseNumber(
      process.env.JWT_REMEMBER_ME_TTL_SECONDS,
      2592000
    ),
  },
  realtime: {
    enabled: parseBoolean(process.env.SOCKET_ENABLED, true),
    path: process.env.SOCKET_PATH || "/socket.io",
  },
  google: {
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  },
};

module.exports = { env };
