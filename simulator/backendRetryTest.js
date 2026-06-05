const { loadConfig } = require("./config");
const { createLogger } = require("./utils/logger");
const ApiClient = require("./core/ApiClient");
const AuthClient = require("./core/AuthClient");
const { ensureSimulationUsers } = require("./setup/ensureSimulationUsers");

const PICKUP = { lat: 5.535, lng: -73.367 };
const DROPOFF = { lat: 5.541, lng: -73.361 };

function createApiClient(config, logger) {
  return new ApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: config.apiTimeoutMs,
    maxRetries: config.maxApiRetries,
    logger,
  });
}

async function login(config, logger, email) {
  const api = createApiClient(config, logger);
  const auth = new AuthClient({
    apiClient: api,
    loginPath: config.authLoginPath,
    password: config.users.password,
    logger,
  });
  const session = await auth.login({ email });
  api.setToken(session.token);
  return { api, user: session.user };
}

async function prepareDriver(config, logger) {
  const driver = await login(
    config,
    logger,
    config.users.driverEmailTemplate.replace("{n}", "1")
  );

  await driver.api.patch(
    config.endpoints.driverStatusPathTemplate.replace(":driverId", driver.user.id),
    { body: { status: "online" } }
  );
  await driver.api.patch(
    config.endpoints.driverLocationPathTemplate.replace(":driverId", driver.user.id),
    {
      body: {
        currentLocation: PICKUP,
        heading: 0,
        speedKmh: 0,
      },
    }
  );

  return driver;
}

function rideBody(source) {
  return {
    pickupAddress: `${source} pickup`,
    pickupLocation: PICKUP,
    dropoffAddress: `${source} dropoff`,
    dropoffLocation: DROPOFF,
    hasDestination: true,
    serviceType: "standard",
    currency: "USD",
    autoAssign: true,
    autoAssignRadiusMeters: 10000,
    autoAssignLimit: 1,
    metadata: {
      source,
    },
  };
}

async function createRide(config, customer, source) {
  const { data } = await customer.api.post(config.endpoints.ridesCreatePath, {
    body: rideBody(source),
  });
  const ride = data?.ride;
  const invite = data?.assignment?.invites?.[0] || null;

  if (!ride?.id) {
    throw new Error(`${source} create ride response missing ride id.`);
  }

  return { ride, invite };
}

async function cancelRide(config, customer, rideId, logger, reason = "simulator_retry_cleanup") {
  if (!rideId) return null;

  try {
    return await customer.api.patch(
      config.endpoints.ridesCancelPathTemplate.replace(":rideId", rideId),
      { body: { cancellationReason: reason } }
    );
  } catch (error) {
    logger?.warn?.(`[RETRY_TEST] cleanup cancel failed for ride=${rideId}: ${error.message}`);
    return null;
  }
}

async function expectControlledError(promise, { status, messagePattern }) {
  try {
    await promise;
  } catch (error) {
    if (error?.status !== status) {
      throw new Error(`Expected HTTP ${status}, got ${error?.status || "NO_STATUS"}.`);
    }
    if (messagePattern && !messagePattern.test(JSON.stringify(error.responseBody || {}))) {
      throw new Error(
        `Expected error body to match ${messagePattern}, got ${JSON.stringify(
          error.responseBody || {}
        )}.`
      );
    }
    return error;
  }

  throw new Error(`Expected controlled HTTP ${status} error, got success.`);
}

function assertOkStatus(result, label) {
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`${label} expected 2xx response.`);
  }
}

async function testDuplicateCreate(config, customer, logger) {
  const { ride } = await createRide(config, customer, "simulator_duplicate_create_test");
  try {
    await expectControlledError(
      customer.api.post(config.endpoints.ridesCreatePath, {
        body: rideBody("simulator_duplicate_create_test"),
      }),
      {
        status: 409,
        messagePattern: /active ride/i,
      }
    );
    logger.info(`[RETRY_TEST] duplicate create returned controlled 409 ride=${ride.id}`);
  } finally {
    await cancelRide(config, customer, ride.id, logger);
  }
}

async function testDuplicateAccept(config, customer, driver, logger) {
  const { ride, invite } = await createRide(config, customer, "simulator_duplicate_accept_test");
  if (!invite) {
    throw new Error("duplicate accept test expected one pending invite.");
  }

  const path = config.endpoints.driverResponsePathTemplate.replace(":rideId", ride.id);
  const first = await driver.api.patch(path, { body: { action: "accept" } });
  const second = await driver.api.patch(path, { body: { action: "accept" } });

  assertOkStatus(first, "duplicate accept first request");
  assertOkStatus(second, "duplicate accept second request");

  if (!second.data?.idempotent || second.data?.ignored) {
    throw new Error(
      `Expected duplicate accept to be idempotent, got ${JSON.stringify(second.data || {})}.`
    );
  }

  logger.info(`[RETRY_TEST] duplicate accept returned idempotent response ride=${ride.id}`);
  await cancelRide(config, customer, ride.id, logger);
}

async function testDuplicateProgress(config, customer, driver, logger) {
  const { ride, invite } = await createRide(config, customer, "simulator_duplicate_progress_test");
  if (!invite) {
    throw new Error("duplicate progress test expected one pending invite.");
  }

  await driver.api.patch(
    config.endpoints.driverResponsePathTemplate.replace(":rideId", ride.id),
    { body: { action: "accept" } }
  );

  const path = config.endpoints.driverProgressPathTemplate.replace(":rideId", ride.id);
  const first = await driver.api.patch(path, { body: { status: "driver_en_route" } });
  const second = await driver.api.patch(path, { body: { status: "driver_en_route" } });

  assertOkStatus(first, "duplicate progress first request");
  assertOkStatus(second, "duplicate progress second request");

  if (second.data?.ride?.status !== "driver_en_route") {
    throw new Error(
      `Expected duplicate progress to keep driver_en_route, got ${JSON.stringify(
        second.data || {}
      )}.`
    );
  }
  if (!second.data?.idempotent || second.data?.statusChanged !== false || second.data?.event) {
    throw new Error(
      `Expected duplicate progress to be an audit no-op, got ${JSON.stringify(
        second.data || {}
      )}.`
    );
  }

  logger.info(`[RETRY_TEST] duplicate progress returned controlled 2xx ride=${ride.id}`);
  await cancelRide(config, customer, ride.id, logger);
}

async function testDuplicateCancel(config, customer, logger) {
  const { ride } = await createRide(config, customer, "simulator_duplicate_cancel_test");
  const path = config.endpoints.ridesCancelPathTemplate.replace(":rideId", ride.id);
  const body = { cancellationReason: "simulator_duplicate_cancel_test" };

  const first = await customer.api.patch(path, { body });
  const second = await customer.api.patch(path, { body });

  assertOkStatus(first, "duplicate cancel first request");
  assertOkStatus(second, "duplicate cancel second request");

  if (second.data?.ride?.status !== "canceled_by_client") {
    throw new Error(
      `Expected duplicate cancel to keep canceled_by_client, got ${JSON.stringify(
        second.data || {}
      )}.`
    );
  }
  if (!second.data?.idempotent || second.data?.statusChanged !== false || second.data?.event) {
    throw new Error(
      `Expected duplicate cancel to be an audit no-op, got ${JSON.stringify(second.data || {})}.`
    );
  }

  logger.info(`[RETRY_TEST] duplicate cancel returned controlled 2xx ride=${ride.id}`);
}

async function runBackendRetryTest({ config, logger, metrics, ensureUsers = true } = {}) {
  const effectiveConfig = config || loadConfig();
  const effectiveLogger =
    logger || createLogger({ level: process.env.SIM_LOG_LEVEL || "info" });

  if (ensureUsers) {
    await ensureSimulationUsers({
      driverCount: Math.max(effectiveConfig.driverCount, 1),
      customerCount: Math.max(effectiveConfig.customerCount, 1),
      password: effectiveConfig.users.password,
      logger: effectiveLogger,
    });
  }

  metrics?.inc?.("backend_retry_tests");

  try {
    const [driver, customer] = await Promise.all([
      prepareDriver(effectiveConfig, effectiveLogger),
      login(
        effectiveConfig,
        effectiveLogger,
        effectiveConfig.users.customerEmailTemplate.replace("{n}", "1")
      ),
    ]);

    await testDuplicateCreate(effectiveConfig, customer, effectiveLogger);
    await testDuplicateAccept(effectiveConfig, customer, driver, effectiveLogger);
    await testDuplicateProgress(effectiveConfig, customer, driver, effectiveLogger);
    await testDuplicateCancel(effectiveConfig, customer, effectiveLogger);

    metrics?.inc?.("backend_retry_tests_passed");
    effectiveLogger.info("[RETRY_TEST] passed duplicate request checks");
    return { pass: true };
  } catch (error) {
    metrics?.inc?.("backend_retry_tests_failed");
    metrics?.recordApiError?.(error, {
      agentType: "backend_retry_test",
      phase: "duplicate_requests",
    });
    effectiveLogger.error(`[RETRY_TEST] failed: ${error.message}`);
    throw error;
  }
}

if (require.main === module) {
  runBackendRetryTest()
    .then(() => {
      process.exitCode = 0;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}

module.exports = {
  runBackendRetryTest,
};
