const { loadConfig } = require("./config");
const { createLogger } = require("./utils/logger");
const ApiClient = require("./core/ApiClient");
const AuthClient = require("./core/AuthClient");
const { ensureSimulationUsers } = require("./setup/ensureSimulationUsers");
const { TUNJA_CENTER } = require("./gps/tunja");

const PICKUP = { ...TUNJA_CENTER };
const DROPOFF = { lat: 5.541, lng: -73.361 };

const DRIVER_FIXTURES = [
  {
    n: 1,
    label: "nearest",
    status: "online",
    location: { lat: PICKUP.lat + 0.00001, lng: PICKUP.lng + 0.00001 },
  },
  {
    n: 2,
    label: "second_nearest",
    status: "online",
    location: { lat: PICKUP.lat + 0.00005, lng: PICKUP.lng + 0.00005 },
  },
  {
    n: 3,
    label: "offline",
    status: "offline",
    location: { lat: PICKUP.lat + 0.00002, lng: PICKUP.lng + 0.00002 },
  },
  {
    n: 4,
    label: "busy",
    status: "busy",
    location: { lat: PICKUP.lat + 0.00003, lng: PICKUP.lng + 0.00003 },
  },
  {
    n: 5,
    label: "too_far",
    status: "online",
    location: { lat: 5.559, lng: -73.344 },
  },
];

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

async function prepareDriver(config, logger, fixture) {
  const session = await login(
    config,
    logger,
    config.users.driverEmailTemplate.replace("{n}", String(fixture.n))
  );

  await session.api.patch(
    config.endpoints.driverLocationPathTemplate.replace(":driverId", session.user.id),
    {
      body: {
        currentLocation: fixture.location,
        heading: 0,
        speedKmh: 0,
      },
    }
  );
  await session.api.patch(
    config.endpoints.driverStatusPathTemplate.replace(":driverId", session.user.id),
    { body: { status: fixture.status } }
  );

  return {
    ...session,
    fixture,
  };
}

async function createMatchingRide(config, customer) {
  const { data } = await customer.api.post(config.endpoints.ridesCreatePath, {
    body: {
      pickupAddress: "Matching test pickup",
      pickupLocation: PICKUP,
      dropoffAddress: "Matching test dropoff",
      dropoffLocation: DROPOFF,
      hasDestination: true,
      serviceType: "standard",
      currency: "USD",
      autoAssign: true,
      autoAssignRadiusMeters: 1000,
      autoAssignLimit: 5,
      metadata: {
        source: "simulator_backend_matching_test",
      },
    },
  });

  if (!data?.ride?.id) {
    throw new Error("Matching test create ride response missing ride id.");
  }

  return {
    ride: data.ride,
    invites: data?.assignment?.invites || [],
  };
}

async function cancelRide(config, customer, rideId, logger) {
  if (!rideId) return;

  try {
    await customer.api.patch(
      config.endpoints.ridesCancelPathTemplate.replace(":rideId", rideId),
      { body: { cancellationReason: "simulator_backend_matching_test_cleanup" } }
    );
  } catch (error) {
    logger?.warn?.(`[MATCHING_TEST] cleanup cancel failed for ride=${rideId}: ${error.message}`);
  }
}

function assertMatchingResult({ drivers, invites }) {
  const byLabel = new Map(drivers.map((driver) => [driver.fixture.label, driver.user.id]));
  const invitedDriverIds = invites.map((invite) => invite.driverId || invite.driver_id);
  const expected = [byLabel.get("nearest"), byLabel.get("second_nearest")];
  const excluded = [
    byLabel.get("offline"),
    byLabel.get("busy"),
    byLabel.get("too_far"),
  ];

  if (JSON.stringify(invitedDriverIds.slice(0, expected.length)) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected nearest online drivers first in order ${JSON.stringify(
        expected
      )}, got ${JSON.stringify(invitedDriverIds)}.`
    );
  }

  for (const driverId of excluded) {
    if (invitedDriverIds.includes(driverId)) {
      throw new Error(`Excluded driver ${driverId} received an invite.`);
    }
  }
}

async function runBackendMatchingTest({ config, logger, metrics, ensureUsers = true } = {}) {
  const effectiveConfig = config || loadConfig();
  const effectiveLogger =
    logger || createLogger({ level: process.env.SIM_LOG_LEVEL || "info" });

  if (ensureUsers) {
    await ensureSimulationUsers({
      driverCount: Math.max(effectiveConfig.driverCount, 5),
      customerCount: Math.max(effectiveConfig.customerCount, 1),
      password: effectiveConfig.users.password,
      logger: effectiveLogger,
    });
  }

  metrics?.inc?.("backend_matching_tests");

  let customer;
  let rideId = null;

  try {
    const drivers = await Promise.all(
      DRIVER_FIXTURES.map((fixture) => prepareDriver(effectiveConfig, effectiveLogger, fixture))
    );
    customer = await login(
      effectiveConfig,
      effectiveLogger,
      effectiveConfig.users.customerEmailTemplate.replace("{n}", "1")
    );

    const { ride, invites } = await createMatchingRide(effectiveConfig, customer);
    rideId = ride.id;

    assertMatchingResult({ drivers, invites });

    metrics?.inc?.("backend_matching_tests_passed");
    effectiveLogger.info(
      `[MATCHING_TEST] passed ride=${rideId} invited=${JSON.stringify(
        invites.map((invite) => invite.driverId || invite.driver_id)
      )}`
    );
    return { pass: true, rideId, invites };
  } catch (error) {
    metrics?.inc?.("backend_matching_tests_failed");
    metrics?.recordApiError?.(error, {
      agentType: "backend_matching_test",
      phase: "driver_matching",
      rideId,
    });
    effectiveLogger.error(`[MATCHING_TEST] failed: ${error.message}`);
    throw error;
  } finally {
    await cancelRide(effectiveConfig, customer, rideId, effectiveLogger);
  }
}

if (require.main === module) {
  runBackendMatchingTest()
    .then(() => {
      process.exitCode = 0;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}

module.exports = {
  runBackendMatchingTest,
};
