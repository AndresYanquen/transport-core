# Taxi Backend Simulator

This folder contains a simulation environment that load-tests the backend as if many mobile clients were connected.

## Safety

This simulator should only be used against local or staging environments.
Do not run it against production unless explicitly intended.

## Principles

- The simulator does NOT call backend services/models directly.
- It only uses HTTP APIs and optional Socket.IO.
- Endpoint paths are configurable via environment variables.

## Requirements

- PostgreSQL is running and migrations applied
- Test users exist (drivers + customers)

## Test Users

The simulator expects users to already exist:

- Drivers: `driver1@test.com` ... `driver100@test.com`
- Customers: `customer1@test.com` ... `customer500@test.com`
- Password: `123456` (configurable via `SIM_USER_PASSWORD`)

You can seed these users however you like. A typical approach is to add a seed script that inserts users + driver/client profiles.

## Configuration

Key environment variables:

- `API_BASE_URL` (default `http://localhost:3000`)
- `SOCKET_URL` (default `API_BASE_URL`)
- `AUTH_LOGIN_PATH` (default `/api/auth/login`)
- `DRIVER_COUNT` (default `100`)
- `CUSTOMER_COUNT` (default `500`)
- `GPS_INTERVAL_MS` (default `5000`)
- `CUSTOMER_REQUEST_INTERVAL_MS` (default `1000`)
- `RIDE_POLL_INTERVAL_MS` (default `3000`)
- `SIMULATION_DURATION_MS` (default `600000`)
- `DRIVER_ACCEPTANCE_RATE` (default `0.75`)
- `CUSTOMER_CANCEL_RATE` (default `0.08`)
- `ENABLE_SOCKETS` (default `false`)
- `ENABLE_CHAOS_MODE` (default `false`)
- `SIM_AUTO_SEED_USERS` (default `true`)
- `SIM_ASSERT_SUCCESS` (default `false`)
- `SIM_MAX_API_ERRORS` (default `0`)
- `SIM_MAX_API_ERROR_RATE` (default `0`)
- `SIM_MIN_RIDES_REQUESTED` (default `1` when customers are enabled, otherwise `0`)
- `SIM_MIN_RIDES_COMPLETED` (default `1` when drivers and customers are enabled, otherwise `0`)
- `SIM_MIN_COMPLETION_RATE` (default `0`)
- `SIM_MAX_AVG_API_MS` (default `2000`)
- `SIM_MAX_AVG_ASSIGNMENT_MS` (default `30000`)

## Sockets

If `ENABLE_SOCKETS=true`, agents will connect via Socket.IO using `handshake.auth.token` and:

- Drivers listen for `ride:invite-created` and respond without polling
- Customers subscribe to the ride room via `ride:subscribe` and consume `ride:status-updated`

If the backend does not emit these events, agents will fallback to periodic HTTP sync.

Endpoint path overrides (defaults match this backend):

- `DRIVER_STATUS_PATH_TEMPLATE` (default `/api/drivers/:driverId/status`)
- `DRIVER_LOCATION_PATH_TEMPLATE` (default `/api/drivers/:driverId/location`)
- `RIDES_CREATE_PATH` (default `/api/rides`)
- `RIDES_GET_PATH_TEMPLATE` (default `/api/rides/:rideId`)
- `RIDES_CANCEL_PATH_TEMPLATE` (default `/api/rides/:rideId/cancel`)
- `DRIVER_INVITES_PATH` (default `/api/rides/driver-invites`)
- `DRIVER_RESPONSE_PATH_TEMPLATE` (default `/api/rides/:rideId/driver-response`)
- `DRIVER_PROGRESS_PATH_TEMPLATE` (default `/api/rides/:rideId/driver-progress`)

## Run

From repo root:

### `npm run simulate`

Runs the full simulator with the default configuration.

By default this starts both sides of the simulated marketplace:

- 100 driver agents from `driver1@test.com` through `driver100@test.com`
- 500 customer agents from `customer1@test.com` through `customer500@test.com`

Driver agents log in, go online, send GPS updates, receive or poll ride invites, accept or reject rides according to `DRIVER_ACCEPTANCE_RATE`, and progress accepted rides through the ride lifecycle.

Customer agents log in, create ride requests, poll or subscribe for ride status updates, and may cancel rides according to `CUSTOMER_CANCEL_RATE`.

Before starting agents, this command ensures the required simulator users exist in the configured database and updates their simulator password to `SIM_USER_PASSWORD`.

To make the command fail when the backend does not meet the simulator criteria, run it with:

- `SIM_ASSERT_SUCCESS=true npm run simulate`

### `npm run simulate:drivers`

Runs only driver agents.

This command sets:

- `DRIVER_COUNT=100`
- `CUSTOMER_COUNT=0`

Use it when you want simulated drivers online and sending locations without creating new customer ride requests from the simulator. Drivers can still respond to rides created elsewhere if the backend sends invites or exposes them through the configured invite endpoint.

### `npm run simulate:customers`

Runs only customer agents.

This command sets:

- `DRIVER_COUNT=0`
- `CUSTOMER_COUNT=500`

Use it when you want to generate ride demand without simulator drivers. This is useful for testing pending ride behavior, assignment failures, timeouts, cancellation paths, or how the backend behaves when there are not enough online drivers.

### `npm run simulate:chaos`

Runs the full simulator with chaos mode enabled.

This command sets:

- `ENABLE_CHAOS_MODE=true`

Chaos mode keeps the same driver/customer defaults unless you override them with environment variables. Use it to exercise less predictable flows and stress behavior while still using the normal backend APIs.

### `npm run simulate:cleanup`

Deletes simulator-created data from the configured database.

This command is different from the other simulator commands because it connects directly to PostgreSQL through the project Knex configuration. It removes rides, ride child records, and simulator users that match the standard simulator email patterns.

Run a dry preview first when you want to see what would be removed:

- `SIM_CLEANUP_DRY_RUN=true npm run simulate:cleanup`

## Cleanup

`npm run simulate:cleanup` deletes simulator data from the configured database:

- simulator rides created by `customerN@test.com` or assigned to `driverN@test.com`
- ride events, driver invites, and ride ratings for those rides
- simulator `drivers`, `clients`, and `users` with emails matching `driverN@test.com` or `customerN@test.com`

Preview matching rows without deleting:

- `SIM_CLEANUP_DRY_RUN=true npm run simulate:cleanup`

The cleanup script refuses to run in `NODE_ENV=production` unless explicitly overridden:

- `SIM_CLEANUP_ALLOW_PRODUCTION=true npm run simulate:cleanup`

## User Setup

By default, simulator commands create or repair the simulator users before agents start:

- `driver1@test.com` through `driverN@test.com`
- `customer1@test.com` through `customerN@test.com`

The password is `SIM_USER_PASSWORD`, defaulting to `123456`. Existing simulator users are updated to that password so login failures caused by stale seed data are avoided.

Disable automatic user setup only when you intentionally want to manage users yourself:

- `SIM_AUTO_SEED_USERS=false npm run simulate`

## Metrics

The simulator prints metrics every 10 seconds:

- drivers online
- customers started
- rides requested / accepted / rejected / cancelled / completed
- GPS updates sent
- API errors
- average API response time
- average ride assignment time
- active rides

Every run also writes a structured backend error report to:

- `simulator/output/errors-<timestamp>.json`

The report includes:

- final simulation summary
- total error count
- grouped errors by `status method path`
- up to 5 samples per error group
- full recorded error entries with agent type/id, phase, ride id, HTTP status, method, path, duration, message, and backend response body

Use this file after a run to inspect exactly which backend endpoint failed and what response body the backend returned.

## Success Criteria

By default, the simulator prints a final `evaluation` object but does not fail the process based on it. Enable strict pass/fail behavior with:

- `SIM_ASSERT_SUCCESS=true npm run simulate`

When assertions are enabled, the simulator exits with code `1` if any final check fails. The default checks are:

- no agent startup failures
- `api_errors <= SIM_MAX_API_ERRORS`
- `api_error_rate <= SIM_MAX_API_ERROR_RATE`
- `rides_requested >= SIM_MIN_RIDES_REQUESTED`
- `rides_completed >= SIM_MIN_RIDES_COMPLETED`
- `completion_rate >= SIM_MIN_COMPLETION_RATE`
- average API latency is at or below `SIM_MAX_AVG_API_MS`
- average assignment latency is at or below `SIM_MAX_AVG_ASSIGNMENT_MS`

Example viability run:

- `SIM_ASSERT_SUCCESS=true SIMULATION_DURATION_MS=60000 SIM_MIN_RIDES_REQUESTED=1 SIM_MIN_RIDES_COMPLETED=1 npm run simulate`

For load tests, use looser thresholds that match the expected stress level:

- `SIM_ASSERT_SUCCESS=true SIM_MAX_API_ERROR_RATE=0.02 SIM_MIN_COMPLETION_RATE=0.7 npm run simulate`

## Adapting Ride Creation

The default ride request body is in `simulator/customers/CustomerAgent.js`. Adjust it to match your backend contract.

## Common Problems

- `401/403`: simulator user not created or wrong password
- `404`: endpoint paths do not match your backend
- `409`: backend rules prevent ride creation (active ride already exists, etc.)
