const { loadConfig } = require("./config");
const { createLogger } = require("./utils/logger");
const ApiClient = require("./core/ApiClient");
const AuthClient = require("./core/AuthClient");
const DriverManager = require("./drivers/DriverManager");
const CustomerManager = require("./customers/CustomerManager");
const MetricsCollector = require("./metrics/MetricsCollector");
const { evaluateSimulation } = require("./metrics/evaluateSimulation");
const { ensureSimulationUsers } = require("./setup/ensureSimulationUsers");
const { runBackendRaceTest } = require("./backendRaceTest");
const { runBackendRetryTest } = require("./backendRetryTest");
const { runBackendMatchingTest } = require("./backendMatchingTest");
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

  if (config.autoSeedUsers) {
    await ensureSimulationUsers({
      driverCount: config.driverCount,
      customerCount: config.customerCount,
      password: config.users.password,
      logger,
    });
  }

  if (config.runBackendRaceTest) {
    await runBackendRaceTest({
      config,
      logger,
      metrics,
      ensureUsers: !config.autoSeedUsers,
    });
  }

  if (config.runBackendRetryTest) {
    await runBackendRetryTest({
      config,
      logger,
      metrics,
      ensureUsers: !config.autoSeedUsers,
    });
  }

  if (config.runBackendMatchingTest) {
    await runBackendMatchingTest({
      config,
      logger,
      metrics,
      ensureUsers: !config.autoSeedUsers,
    });
  }

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
  shutdown();
  const managerResults = await work;
  if (forceExitTimer !== null) {
    clearTimeout(forceExitTimer);
  }

  clearInterval(metricsTimer);
  metrics.printLive();
  let summary = metrics.summary();
  const errorReportPath = metrics.writeErrorReport(summary);
  summary = metrics.summary();
  logger.info("[SIMULATOR] final summary: ", JSON.stringify(summary));
  if (errorReportPath) {
    logger.info(`[SIMULATOR] error report: ${errorReportPath}`);
  }

  const agentFailures = collectAgentFailures(managerResults);
  const evaluation = evaluateSimulation({ summary, config, agentFailures });
  logger.info("[SIMULATOR] evaluation: ", JSON.stringify(evaluation));
  if (config.success.assert && !evaluation.pass) {
    process.exitCode = 1;
  }
  metrics.close();
}

function collectAgentFailures(managerResults) {
  const failures = [];
  for (const managerResult of managerResults || []) {
    if (managerResult.status === "rejected") {
      failures.push({ scope: "manager", reason: String(managerResult.reason?.message || managerResult.reason) });
      continue;
    }

    for (const agentResult of managerResult.value || []) {
      if (isAbortReason(agentResult.reason)) continue;
      if (agentResult.status === "rejected") {
        failures.push({ scope: "agent", reason: String(agentResult.reason?.message || agentResult.reason) });
      }
    }
  }
  return failures;
}

function isAbortReason(reason) {
  return reason?.code === "ABORT_ERR" || reason?.message === "Aborted";
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[SIMULATOR] fatal: ", err);
  process.exitCode = 1;
});
