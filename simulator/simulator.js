const { loadConfig } = require("./config");
const { createLogger } = require("./utils/logger");
const ApiClient = require("./core/ApiClient");
const AuthClient = require("./core/AuthClient");
const DriverManager = require("./drivers/DriverManager");
const CustomerManager = require("./customers/CustomerManager");
const MetricsCollector = require("./metrics/MetricsCollector");
const { sleep } = require("./utils/sleep");

function buildApiClientFactory(config) {
  return (logger, abortSignal) =>
    new ApiClient({
      baseUrl: config.apiBaseUrl,
      timeoutMs: config.apiTimeoutMs,
      maxRetries: config.maxApiRetries,
      logger,
      abortSignal,
    });
}

function buildAuthClientFactory(config) {
  return (apiClient, logger) =>
    new AuthClient({
      apiClient,
      loginPath: config.authLoginPath,
      password: config.users.password,
      logger,
    });
}

async function main() {
  const config = loadConfig();
  const logger = createLogger({ level: process.env.SIM_LOG_LEVEL || "info" });
  const metrics = new MetricsCollector({ logger, enableCsv: false });

  const abortController = new AbortController();
  let forceExitTimer = null;

  const apiClientFactory = buildApiClientFactory(config);
  const authClientFactory = buildAuthClientFactory(config);

  const driversAbort = new AbortController();
  const customersAbort = new AbortController();

  const driverManager = new DriverManager({
    config,
    metrics,
    apiClientFactory,
    authClientFactory,
    abortController: driversAbort,
    logger,
  });

  const customerManager = new CustomerManager({
    config,
    metrics,
    apiClientFactory,
    authClientFactory,
    abortController: customersAbort,
    logger,
  });

  function shutdown() {
    if (abortController.signal.aborted) return;
    abortController.abort();
    driversAbort.abort();
    customersAbort.abort();

    // Some environments keep the process alive due to in-flight sockets/HTTP.
    // Force exit after a grace period so Ctrl+C is reliable.
    if (forceExitTimer === null) {
      forceExitTimer = setTimeout(() => {
        logger.warn("[SIMULATOR] force exiting after shutdown grace period");
        process.exit(0);
      }, config.shutdownForceExitMs);
      // Don't keep Node alive just for this timer if everything shuts down cleanly.
      forceExitTimer.unref?.();
    }
  }

  process.on("SIGINT", () => {
    logger.warn("[SIMULATOR] SIGINT received, shutting down...");
    shutdown();
  });

  logger.info(
    `[SIMULATOR] baseUrl=${config.apiBaseUrl} drivers=${config.driverCount} customers=${config.customerCount} durationMs=${config.simulationDurationMs} sockets=${config.enableSockets}`
  );

  const metricsTimer = setInterval(() => metrics.printLive(), config.metricsPrintIntervalMs);

  const driverTask = config.driverCount > 0 ? driverManager.start() : Promise.resolve();
  const customerTask =
    config.customerCount > 0 ? customerManager.start() : Promise.resolve();

  const work = Promise.allSettled([driverTask, customerTask]);
  // If work finishes early (e.g. config=0 or auth failing), abort timers so Node can exit.
  work.finally(() => shutdown());

  const endTimer = (async () => {
    await sleep(config.simulationDurationMs, abortController.signal).catch(() => {});
    shutdown();
  })();

  await Promise.race([work, endTimer]);

  clearInterval(metricsTimer);
  metrics.printLive();
  logger.info("[SIMULATOR] final summary: ", JSON.stringify(metrics.summary()));
  metrics.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[SIMULATOR] fatal: ", err);
  process.exitCode = 1;
});
