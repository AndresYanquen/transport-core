const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

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

function buildIceServers() {
  const servers = [];
  const stunUrls = parseCsv(process.env.WEBRTC_STUN_URLS, ["stun:stun.l.google.com:19302"]);
  if (stunUrls.length) servers.push({ urls: stunUrls });
  if (process.env.WEBRTC_TURN_URL) {
    servers.push({
      urls: process.env.WEBRTC_TURN_URL,
      username: process.env.WEBRTC_TURN_USERNAME || "",
      credential: process.env.WEBRTC_TURN_CREDENTIAL || "",
    });
  }
  return servers;
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
  http: {
    trustProxy: parseNumber(process.env.HTTP_TRUST_PROXY, 1),
    jsonBodyLimit: process.env.HTTP_JSON_BODY_LIMIT || "1mb",
    requestLogsEnabled: parseBoolean(process.env.HTTP_REQUEST_LOGS_ENABLED, true),
    authRateLimitWindowMs: parseNumber(
      process.env.AUTH_RATE_LIMIT_WINDOW_MS,
      15 * 60 * 1000
    ),
    authRateLimitMax: parseNumber(process.env.AUTH_RATE_LIMIT_MAX, 100),
    shutdownTimeoutMs: parseNumber(process.env.SHUTDOWN_TIMEOUT_MS, 10000),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
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
  redis: {
    url: process.env.REDIS_URL || "",
    connectTimeoutMs: parseNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, 5000),
    maxReconnectDelayMs: parseNumber(process.env.REDIS_MAX_RECONNECT_DELAY_MS, 2000),
  },
  driverPresence: {
    staleAfterSeconds: parseNumber(process.env.DRIVER_PRESENCE_STALE_SECONDS, 90),
    sweepIntervalSeconds: parseNumber(process.env.DRIVER_PRESENCE_SWEEP_SECONDS, 30),
    cacheEnabled: parseBoolean(process.env.DRIVER_PRESENCE_CACHE_ENABLED, true),
  },
  radio: {
    requestTtlSeconds: parseNumber(process.env.RADIO_REQUEST_TTL_SECONDS, 180),
    connectTimeoutSeconds: parseNumber(process.env.RADIO_CONNECT_TIMEOUT_SECONDS, 15),
    idleTimeoutSeconds: parseNumber(process.env.RADIO_IDLE_TIMEOUT_SECONDS, 45),
    sweepIntervalSeconds: parseNumber(process.env.RADIO_SWEEP_INTERVAL_SECONDS, 5),
    iceServers: buildIceServers(),
  },
  google: {
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  },
};

module.exports = { env };
