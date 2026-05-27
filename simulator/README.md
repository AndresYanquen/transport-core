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

- `npm run simulate`
- `npm run simulate:drivers`
- `npm run simulate:customers`
- `npm run simulate:chaos`

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

## Adapting Ride Creation

The default ride request body is in `simulator/customers/CustomerAgent.js`. Adjust it to match your backend contract.

## Common Problems

- `401/403`: simulator user not created or wrong password
- `404`: endpoint paths do not match your backend
- `409`: backend rules prevent ride creation (active ride already exists, etc.)
