const express = require("express");
const cors = require("cors");

const { pool } = require("./config/database");
const { env } = require("./config");
const authRoutes = require("./modules/auth/routes/auth.routes");
const rideRoutes = require("./modules/rides/routes/ride.routes");
const driverRoutes = require("./modules/drivers/routes/driver.routes");
const { authenticate } = require("./modules/auth/middleware/authentication.middleware");

const app = express();

const allowedOrigins = env.cors.allowedOrigins || [];
const allowAllOrigins = allowedOrigins.includes("*");

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/rides", authenticate, rideRoutes);
app.use("/api/drivers", authenticate, driverRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
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
