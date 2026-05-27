const DEFAULTS = {
  API_BASE_URL: "http://localhost:3000",
  SOCKET_URL: "http://localhost:3000",
  AUTH_LOGIN_PATH: "/api/auth/login",
  DRIVER_COUNT: 10,
  CUSTOMER_COUNT: 20,
  GPS_INTERVAL_MS: 5000,
  CUSTOMER_REQUEST_INTERVAL_MS: 1000,
  RIDE_POLL_INTERVAL_MS: 3000,
  SIMULATION_DURATION_MS: 10 * 60 * 1000,
  DRIVER_ACCEPTANCE_RATE: 0.75,
  CUSTOMER_CANCEL_RATE: 0.08,
  ENABLE_SOCKETS: false,
  ENABLE_CHAOS_MODE: false,
  METRICS_PRINT_INTERVAL_MS: 10_000,
  MAX_API_RETRIES: 2,
  API_TIMEOUT_MS: 10_000,
  MAX_CONCURRENT_CUSTOMERS: 50,
  SHUTDOWN_FORCE_EXIT_MS: 4000,
};

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const v = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

function loadConfig() {
  return {
    apiBaseUrl: process.env.API_BASE_URL || DEFAULTS.API_BASE_URL,
    socketUrl: process.env.SOCKET_URL || process.env.API_BASE_URL || DEFAULTS.SOCKET_URL,
    authLoginPath: process.env.AUTH_LOGIN_PATH || DEFAULTS.AUTH_LOGIN_PATH,
    driverCount: toNumber(process.env.DRIVER_COUNT, DEFAULTS.DRIVER_COUNT),
    customerCount: toNumber(process.env.CUSTOMER_COUNT, DEFAULTS.CUSTOMER_COUNT),
    gpsIntervalMs: toNumber(process.env.GPS_INTERVAL_MS, DEFAULTS.GPS_INTERVAL_MS),
    customerRequestIntervalMs: toNumber(
      process.env.CUSTOMER_REQUEST_INTERVAL_MS,
      DEFAULTS.CUSTOMER_REQUEST_INTERVAL_MS
    ),
    ridePollIntervalMs: toNumber(
      process.env.RIDE_POLL_INTERVAL_MS,
      DEFAULTS.RIDE_POLL_INTERVAL_MS
    ),
    simulationDurationMs: toNumber(
      process.env.SIMULATION_DURATION_MS,
      DEFAULTS.SIMULATION_DURATION_MS
    ),
    driverAcceptanceRate: toNumber(
      process.env.DRIVER_ACCEPTANCE_RATE,
      DEFAULTS.DRIVER_ACCEPTANCE_RATE
    ),
    customerCancelRate: toNumber(
      process.env.CUSTOMER_CANCEL_RATE,
      DEFAULTS.CUSTOMER_CANCEL_RATE
    ),
    enableSockets: toBool(process.env.ENABLE_SOCKETS, DEFAULTS.ENABLE_SOCKETS),
    enableChaosMode: toBool(process.env.ENABLE_CHAOS_MODE, DEFAULTS.ENABLE_CHAOS_MODE),
    metricsPrintIntervalMs: toNumber(
      process.env.METRICS_PRINT_INTERVAL_MS,
      DEFAULTS.METRICS_PRINT_INTERVAL_MS
    ),
    maxApiRetries: toNumber(process.env.MAX_API_RETRIES, DEFAULTS.MAX_API_RETRIES),
    apiTimeoutMs: toNumber(process.env.API_TIMEOUT_MS, DEFAULTS.API_TIMEOUT_MS),
    maxConcurrentCustomers: toNumber(
      process.env.MAX_CONCURRENT_CUSTOMERS,
      DEFAULTS.MAX_CONCURRENT_CUSTOMERS
    ),
    shutdownForceExitMs: toNumber(
      process.env.SHUTDOWN_FORCE_EXIT_MS,
      DEFAULTS.SHUTDOWN_FORCE_EXIT_MS
    ),
    endpoints: {
      driverStatusPathTemplate:
        process.env.DRIVER_STATUS_PATH_TEMPLATE || "/api/drivers/:driverId/status",
      driverLocationPathTemplate:
        process.env.DRIVER_LOCATION_PATH_TEMPLATE || "/api/drivers/:driverId/location",
      ridesCreatePath: process.env.RIDES_CREATE_PATH || "/api/rides",
      ridesGetPathTemplate:
        process.env.RIDES_GET_PATH_TEMPLATE || "/api/rides/:rideId",
      ridesCancelPathTemplate:
        process.env.RIDES_CANCEL_PATH_TEMPLATE || "/api/rides/:rideId/cancel",
      driverInvitesPath: process.env.DRIVER_INVITES_PATH || "/api/rides/driver-invites",
      driverResponsePathTemplate:
        process.env.DRIVER_RESPONSE_PATH_TEMPLATE ||
        "/api/rides/:rideId/driver-response",
      driverProgressPathTemplate:
        process.env.DRIVER_PROGRESS_PATH_TEMPLATE ||
        "/api/rides/:rideId/driver-progress",
    },
    socket: {
      path: process.env.SOCKET_PATH || "/socket.io",
    },
    users: {
      password: process.env.SIM_USER_PASSWORD || "123456",
      driverEmailTemplate: process.env.DRIVER_EMAIL_TEMPLATE || "driver{n}@test.com",
      customerEmailTemplate:
        process.env.CUSTOMER_EMAIL_TEMPLATE || "customer{n}@test.com",
    },
    gps: {
      centerLat: toNumber(process.env.GPS_CENTER_LAT, 5.535),
      centerLng: toNumber(process.env.GPS_CENTER_LNG, -73.367),
      radiusKm: toNumber(process.env.GPS_RADIUS_KM, 6),
    },
  };
}

module.exports = {
  loadConfig,
};
