const { loadConfig } = require("./config");
const { createLogger } = require("./utils/logger");
const ApiClient = require("./core/ApiClient");
const AuthClient = require("./core/AuthClient");
const { ensureSimulationUsers } = require("./setup/ensureSimulationUsers");

const RACE_PICKUP = { lat: 5.535, lng: -73.367 };
const RACE_DROPOFF = { lat: 5.541, lng: -73.361 };

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

async function prepareDriver(config, logger, n, location) {
  const email = config.users.driverEmailTemplate.replace("{n}", String(n));
  const session = await login(config, logger, email);

  await session.api.patch(
    config.endpoints.driverStatusPathTemplate.replace(":driverId", session.user.id),
    { body: { status: "online" } }
  );
  await session.api.patch(
    config.endpoints.driverLocationPathTemplate.replace(":driverId", session.user.id),
    {
      body: {
        currentLocation: location,
        heading: 0,
        speedKmh: 0,
      },
    }
  );

  return session;
}

async function createRaceRide(config, logger, customer) {
  const { data } = await customer.api.post(config.endpoints.ridesCreatePath, {
    body: {
      pickupAddress: "Race test pickup",
      pickupLocation: RACE_PICKUP,
      dropoffAddress: "Race test dropoff",
      dropoffLocation: RACE_DROPOFF,
      hasDestination: true,
      serviceType: "standard",
      currency: "USD",
      autoAssign: true,
      autoAssignRadiusMeters: 10000,
      autoAssignLimit: 2,
      metadata: {
        source: "simulator_backend_race_test",
      },
    },
  });

  const ride = data?.ride;
  const invites = data?.assignment?.invites || [];
  if (!ride?.id) {
    throw new Error("Race test create ride response missing ride id.");
  }
  if (invites.length < 2) {
    throw new Error(`Race test expected at least 2 pending invites, got ${invites.length}.`);
  }

  logger?.info?.(`[RACE_TEST] created ride=${ride.id} invites=${invites.length}`);
  return { ride, invites };
}

function summarizeDriverResponse(result, driverId) {
  if (result.status === "rejected") {
    const error = result.reason;
    return {
      driverId,
      ok: false,
      status: error?.status || null,
      message: error?.message || String(error),
      responseBody: error?.responseBody || null,
    };
  }

  const data = result.value?.data || {};
  return {
    driverId,
    ok: true,
    status: result.value?.status || null,
    assignedDriverId: data?.ride?.driverId || data?.ride?.driver_id || null,
    ignored: Boolean(data?.ignored),
    ignoreReason: data?.ignoreReason || null,
    idempotent: Boolean(data?.idempotent),
  };
}

function assertRaceResult(responses) {
  const winners = responses.filter(
    (response) =>
      response.ok &&
      !response.ignored &&
      response.assignedDriverId &&
      response.assignedDriverId === response.driverId
  );
  const controlledLosers = responses.filter(
    (response) =>
      response.ok &&
      response.ignored &&
      response.ignoreReason &&
      response.assignedDriverId &&
      response.assignedDriverId !== response.driverId
  );

  if (winners.length !== 1 || controlledLosers.length !== 1) {
    throw new Error(
      `Race test expected exactly one winner and one controlled loser. responses=${JSON.stringify(
        responses
      )}`
    );
  }
}

async function cancelRaceRide(config, customer, rideId, logger) {
  if (!rideId) return;

  try {
    await customer.api.patch(
      config.endpoints.ridesCancelPathTemplate.replace(":rideId", rideId),
      { body: { cancellationReason: "simulator_backend_race_test_cleanup" } }
    );
  } catch (error) {
    logger?.warn?.(`[RACE_TEST] cleanup cancel failed for ride=${rideId}: ${error.message}`);
  }
}

async function runBackendRaceTest({ config, logger, metrics, ensureUsers = true } = {}) {
  const effectiveConfig = config || loadConfig();
  const effectiveLogger =
    logger || createLogger({ level: process.env.SIM_LOG_LEVEL || "info" });

  if (ensureUsers) {
    await ensureSimulationUsers({
      driverCount: Math.max(effectiveConfig.driverCount, 2),
      customerCount: Math.max(effectiveConfig.customerCount, 1),
      password: effectiveConfig.users.password,
      logger: effectiveLogger,
    });
  }

  metrics?.inc?.("backend_race_tests");

  let customer;
  let rideId = null;

  try {
    const [driverA, driverB, customerSession] = await Promise.all([
      prepareDriver(effectiveConfig, effectiveLogger, 1, RACE_PICKUP),
      prepareDriver(effectiveConfig, effectiveLogger, 2, {
        lat: RACE_PICKUP.lat + 0.0001,
        lng: RACE_PICKUP.lng + 0.0001,
      }),
      login(
        effectiveConfig,
        effectiveLogger,
        effectiveConfig.users.customerEmailTemplate.replace("{n}", "1")
      ),
    ]);
    customer = customerSession;

    const { ride, invites } = await createRaceRide(effectiveConfig, effectiveLogger, customer);
    rideId = ride.id;

    const invitedDriverIds = new Set(invites.map((invite) => invite.driverId || invite.driver_id));
    const raceDrivers = [driverA, driverB].filter((driver) => invitedDriverIds.has(driver.user.id));
    if (raceDrivers.length !== 2) {
      throw new Error(
        `Race test expected drivers 1 and 2 to be invited. invited=${JSON.stringify([
          ...invitedDriverIds,
        ])}`
      );
    }

    const path = effectiveConfig.endpoints.driverResponsePathTemplate.replace(":rideId", rideId);
    const settled = await Promise.allSettled(
      raceDrivers.map((driver) => driver.api.patch(path, { body: { action: "accept" } }))
    );
    const responses = settled.map((result, index) =>
      summarizeDriverResponse(result, raceDrivers[index].user.id)
    );

    assertRaceResult(responses);
    metrics?.inc?.("backend_race_tests_passed");
    effectiveLogger.info(`[RACE_TEST] passed responses=${JSON.stringify(responses)}`);
    return { pass: true, rideId, responses };
  } catch (error) {
    metrics?.inc?.("backend_race_tests_failed");
    metrics?.recordApiError?.(error, {
      agentType: "backend_race_test",
      phase: "driver_accept_race",
      rideId,
    });
    effectiveLogger.error(`[RACE_TEST] failed: ${error.message}`);
    throw error;
  } finally {
    await cancelRaceRide(effectiveConfig, customer, rideId, effectiveLogger);
  }
}

if (require.main === module) {
  runBackendRaceTest()
    .then(() => {
      process.exitCode = 0;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}

module.exports = {
  runBackendRaceTest,
};
