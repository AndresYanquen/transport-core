const express = require("express");
const cors = require("cors");

const { pool } = require("./config/database");
const { env } = require("./config");
const { corsOptions } = require("./config/cors");
const authRoutes = require("./modules/auth/routes/auth.routes");
const rideRoutes = require("./modules/rides/routes/ride.routes");
const driverRoutes = require("./modules/drivers/routes/driver.routes");
const placesRoutes = require("./modules/places/routes/places.routes");
const preferencesRoutes = require("./modules/preferences/routes/preferences.routes");
const adminSimulationRoutes = require("./modules/admin-simulation/routes/admin-simulation.routes");
const { authenticate } = require("./modules/auth/middleware/authentication.middleware");

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/rides", authenticate, rideRoutes);
app.use("/api/drivers", authenticate, driverRoutes);
app.use("/api/places", authenticate, placesRoutes);
app.use("/api/preferences", authenticate, preferencesRoutes);
//app.use("/places", authenticate, placesRoutes); -- no calls
// Public in non-production for debugging. In production, require auth + admin role.
if (String(env.nodeEnv || "").toLowerCase() === "production") {
  app.use("/api/admin/simulation", authenticate, adminSimulationRoutes);
} else {
  app.use("/api/admin/simulation", adminSimulationRoutes);
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      db: "ok",
      env: env.nodeEnv,
    });
  } catch (error) {
    console.error("Health check database probe failed:", error);
    res.status(503).json({
      status: "error",
      db: "unreachable",
      env: env.nodeEnv,
    });
  }
});

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to PostgreSQL database successfully.");
  } catch (error) {
    console.error("Failed to connect to PostgreSQL database:", error);
  }
})();

app.use((req, res) => {
  res.status(404).json({
    message: `Route ${req.originalUrl} not found`,
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

module.exports = app;
