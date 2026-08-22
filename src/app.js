const express = require("express");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");

const { pool } = require("./config/database");
const { env } = require("./config");
const { corsOptions } = require("./config/cors");
const { logger } = require("./config/logger");
const { requestLogger } = require("./middleware/request-logger.middleware");
const { createAuthRateLimiter } = require("./middleware/rate-limit.middleware");
const authRoutes = require("./modules/auth/routes/auth.routes");
const rideRoutes = require("./modules/rides/routes/ride.routes");
const publicRideTrackingRoutes = require("./modules/rides/routes/public-ride-tracking.routes");
const driverRoutes = require("./modules/drivers/routes/driver.routes");
const placesRoutes = require("./modules/places/routes/places.routes");
const preferencesRoutes = require("./modules/preferences/routes/preferences.routes");
const savedDestinationRoutes = require("./modules/saved-destinations/routes/saved-destination.routes");
const preferredDriverRoutes = require("./modules/preferred-drivers/routes/preferred-driver.routes");
const userRoutes = require("./modules/users/routes/user.routes");
const serviceTypeRoutes = require("./modules/service-types/routes/service-type.routes");
const settingsRoutes = require("./modules/settings/routes/settings.routes");
const adminSimulationRoutes = require("./modules/admin-simulation/routes/admin-simulation.routes");
const adminNavigationRoutes = require("./modules/admin-navigation/routes/admin-navigation.routes");
const adminOperationalParametersRoutes = require("./modules/admin-operational-parameters/routes/admin-operational-parameters.routes");
const adminUsersRoutes = require("./modules/admin-users/routes/admin-users.routes");
const adminZonesRoutes = require("./modules/admin-zones/routes/admin-zones.routes");
const adminDriversMapRoutes = require("./modules/admin-drivers-map/routes/admin-drivers-map.routes");
const adminHotZonesRoutes = require("./modules/admin-hot-zones/routes/admin-hot-zones.routes");
const radioRoutes = require("./modules/radio/routes/radio.routes");
const driverNotificationRoutes = require("./modules/driver-notifications/routes/driver-notification.routes");
const { authenticate } = require("./modules/auth/middleware/authentication.middleware");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.http.trustProxy);
app.use(helmet());
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: env.http.jsonBodyLimit }));
app.use(requestLogger);

const authRateLimiter = createAuthRateLimiter();

app.use("/api/auth", authRateLimiter, authRoutes);
app.use("/api/rides/public", publicRideTrackingRoutes);
app.use("/api/rides", authenticate, rideRoutes);
app.use("/api/drivers", authenticate, driverRoutes);
app.use("/api/places", authenticate, placesRoutes);
app.use("/api/preferences", authenticate, preferencesRoutes);
app.use("/api/saved-destinations", authenticate, savedDestinationRoutes);
app.use("/api/preferred-drivers", authenticate, preferredDriverRoutes);
app.use("/api/users", authenticate, userRoutes);
app.use("/api/service-types", authenticate, serviceTypeRoutes);
app.use("/api/settings", authenticate, settingsRoutes);
app.use("/api/radio", authenticate, radioRoutes);
app.use("/api/driver-notifications", authenticate, driverNotificationRoutes);
app.use("/api/admin/navigation", authenticate, adminNavigationRoutes);
app.use("/api/admin/operational-parameters", authenticate, adminOperationalParametersRoutes);
app.use("/api/admin/users", authenticate, adminUsersRoutes);
app.use("/api/admin/zones", authenticate, adminZonesRoutes);
app.use("/api/admin/drivers-map", authenticate, adminDriversMapRoutes);
app.use("/api/admin/hot-zones", authenticate, adminHotZonesRoutes);
//app.use("/places", authenticate, placesRoutes); -- no calls
// Public in non-production for debugging. In production, require auth + admin role.
if (String(env.nodeEnv || "").toLowerCase() === "production") {
  app.use("/api/admin/simulation", authenticate, adminSimulationRoutes);
} else {
  app.use("/api/admin/simulation", adminSimulationRoutes);
}

app.get("/api/live", (_req, res) => {
  res.status(200).json({
    status: "ok",
    env: env.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get(["/api/ready", "/api/health"], async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      db: "ok",
      env: env.nodeEnv,
    });
  } catch (error) {
    logger.error("readiness_check_failed", { error });
    res.status(503).json({
      status: "error",
      db: "unreachable",
      env: env.nodeEnv,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    message: `Route ${req.originalUrl} not found`,
  });
});

app.use((err, _req, res, _next) => {
  logger.error("unhandled_request_error", { error: err });
  const isProduction = String(env.nodeEnv || "").toLowerCase() === "production";
  res.status(err.status || 500).json({
    message: isProduction && !err.status ? "Internal server error" : err.message || "Internal server error",
  });
});

module.exports = app;
