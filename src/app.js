const express = require("express");
const cors = require("cors");

const { pool } = require("./config/database");
const authRoutes = require("./modules/auth/routes/auth.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

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
