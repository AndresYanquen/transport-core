const http = require("http");

const app = require("./app");
const { env } = require("./config");
const { pool } = require("./config/database");
const { closeRedisClients } = require("./config/redis");
const { logger } = require("./config/logger");
const { validateProductionEnv } = require("./config/validate-env");
const { initializeSocketServer, closeSocketServer } = require("./realtime/socket.server");
const {
  startDriverPresenceWorker,
  stopDriverPresenceWorker,
} = require("./modules/drivers/services/driver-presence.worker");
const { startRadioWorker, stopRadioWorker } = require("./modules/radio/services/radio.worker");

const server = http.createServer(app);

let shuttingDown = false;

async function assertDatabaseConnection() {
  await pool.query("SELECT 1");
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("shutdown_started", { signal });

  stopDriverPresenceWorker();
  stopRadioWorker();

  const forceExitTimer = setTimeout(() => {
    logger.error("shutdown_forced", { signal });
    process.exit(1);
  }, env.http.shutdownTimeoutMs);
  forceExitTimer.unref();

  try {
    await closeSocketServer();
    await closeRedisClients();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.end();
    clearTimeout(forceExitTimer);
    logger.info("shutdown_completed", { signal });
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    logger.error("shutdown_failed", { signal, error });
    process.exit(1);
  }
}

async function start() {
  try {
    validateProductionEnv();
    await assertDatabaseConnection();
    logger.info("database_connected");

    await initializeSocketServer(server);
    startDriverPresenceWorker();
    startRadioWorker();

    server.listen(env.port, () => {
      logger.info("server_listening", { port: env.port, nodeEnv: env.nodeEnv });
    });
  } catch (error) {
    logger.error("startup_failed", { error });
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", { error });
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    error: reason instanceof Error ? reason : new Error(String(reason)),
  });
  shutdown("unhandledRejection");
});

start();
