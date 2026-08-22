# Taxi Backend

Modular Node.js backend powered by Express. Features a pluggable module system with dedicated sub-folders for controllers, services, models, routes, and middleware. The first module implemented is `auth`, which demonstrates the expected layout.

## Getting Started

```bash
npm install
cp .env.example .env
npm run dev
```

Run database migrations before starting the server (requires PostgreSQL with PostGIS + pgcrypto extensions available):

```bash
npm run migrate:latest
```

Seed the database with a demo user (email `demo@example.com`, password `TestPassword123!`):

```bash
npm run seed:run
```

Seed data creates an admin plus sample client (`client@example.com`) and driver (`driver@example.com`) accounts. All seeded users share the password `TestPassword123!`. Seeded client/driver rows include PostGIS geography points for home/current locations.

The server listens on `http://localhost:3000` by default. Update `.env` to point at your PostgreSQL instance; the template is preconfigured for a local database on `localhost:5432` with user `andresyanquen` and password `12345`.

## Environment Variables

Copy `.env.example` to `.env` for local development. In production, `JWT_SECRET`, database settings, and `CORS_ALLOWED_ORIGINS` are required; startup fails if they are missing.

| Variable | Default/example | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime environment. Use `production` in deployed environments. |
| `PORT` | `3000` | HTTP port used by `src/server.js`. |
| `DB_HOST` | `localhost` | PostgreSQL host. Required in production. |
| `DB_PORT` | `5432` | PostgreSQL port. |
| `DB_NAME` | `postgres` | PostgreSQL database name. Required in production. |
| `DB_USER` | `postgres` | PostgreSQL user. Required in production. |
| `DB_PASSWORD` | `change-me` | PostgreSQL password. Required in production. |
| `DB_SSL` | `false` | Enables SSL for PostgreSQL connections. |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` | Controls PostgreSQL SSL certificate verification. Use `true` when your provider supports trusted certificates. |
| `DB_CONNECTION_TIMEOUT_MS` | `5000` | Maximum time to wait when opening a PostgreSQL connection. |
| `DB_IDLE_TIMEOUT_MS` | `30000` | Time before idle PostgreSQL pool clients are closed. |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL connections per API process. Reduce this when running multiple instances. |
| `JWT_SECRET` | `change-me-in-production` | JWT signing secret. Required in production and must not use the development fallback. |
| `JWT_ACCESS_TTL_SECONDS` | `3600` | Access token lifetime in seconds. |
| `JWT_REMEMBER_ME_TTL_SECONDS` | `2592000` | Longer token lifetime for remember-me sessions. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3001,http://localhost:5173` | Comma-separated browser origins allowed to call the API. Required in production. Do not use `*` in production. |
| `CORS_ALLOW_LOCALHOST_TEMP` | `false` | Temporarily allows localhost origins in production when set to a truthy value. Keep disabled for normal production. |
| `LOG_LEVEL` | `info` | Minimum log level. Supported values: `debug`, `info`, `warn`, `error`, `silent`. |
| `HTTP_TRUST_PROXY` | `1` | Express `trust proxy` setting. Use `1` behind one load balancer/proxy. |
| `HTTP_JSON_BODY_LIMIT` | `1mb` | Maximum JSON request body size accepted by Express. |
| `HTTP_REQUEST_LOGS_ENABLED` | `true` | Enables one structured log line per HTTP request. Set to `false` to disable request access logs. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | Rate-limit window for `/api/auth` requests, in milliseconds. |
| `AUTH_RATE_LIMIT_MAX` | `100` | Maximum `/api/auth` requests per rate-limit window per client. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful shutdown timeout before forcing process exit. |
| `SOCKET_ENABLED` | `true` | Enables Socket.IO realtime server. |
| `SOCKET_PATH` | `/socket.io` | Socket.IO endpoint path. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL. When set, Socket.IO uses Redis pub/sub and auth rate limiting uses a distributed Redis store. |
| `REDIS_CONNECT_TIMEOUT_MS` | `5000` | Redis connection timeout in milliseconds. |
| `REDIS_MAX_RECONNECT_DELAY_MS` | `2000` | Maximum Redis reconnect delay in milliseconds. |
| `DRIVER_PRESENCE_STALE_SECONDS` | `90` | Age after which online driver presence is considered stale. |
| `DRIVER_PRESENCE_SWEEP_SECONDS` | `30` | Interval for sweeping stale driver presence records. |
| `DRIVER_PRESENCE_CACHE_ENABLED` | `true` | Enables best-effort Redis cache writes for recent online driver presence when `REDIS_URL` is set. |
| `RADIO_REQUEST_TTL_SECONDS` | `180` | Time before pending radio requests expire. |
| `RADIO_CONNECT_TIMEOUT_SECONDS` | `15` | Time allowed for radio sessions to connect. |
| `RADIO_IDLE_TIMEOUT_SECONDS` | `45` | Idle timeout for radio sessions. |
| `RADIO_SWEEP_INTERVAL_SECONDS` | `5` | Interval for radio timeout cleanup. |
| `WEBRTC_STUN_URLS` | `stun:stun.l.google.com:19302` | Comma-separated STUN URLs returned by `/api/radio/ice-config`. |
| `WEBRTC_TURN_URL` | empty | TURN server URL for WebRTC when available. |
| `WEBRTC_TURN_USERNAME` | empty | TURN username. |
| `WEBRTC_TURN_CREDENTIAL` | empty | TURN credential/password. |
| `GOOGLE_MAPS_API_KEY` | empty | Google Maps API key used by the places module. |

## Project Structure

```

## Docker

Build and run the backend image:

```bash
docker build -t taxi-backend .
docker run --env-file .env -e DB_HOST=host.docker.internal -p 3000:3000 taxi-backend
```

Build and run the administrative frontend image:

```bash
docker build -t taxi-admin-client ./client
docker run -p 8080:80 taxi-admin-client
```

The default frontend image is built with `VITE_API_BASE_URL=http://localhost:3000`, so the browser calls the backend exposed on port `3000`. Override it at build time when deploying behind another API URL:

```bash
docker build \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  --build-arg VITE_SOCKET_PATH=/socket.io \
  -t taxi-admin-client \
  ./client
```

To run both containers locally with the existing local PostgreSQL instance:

```bash
docker compose up --build
```

Compose also starts Redis at `redis://redis:6379` for the backend and exposes it locally on port `6379`. Backend: `http://localhost:3000`. Admin frontend: `http://localhost:8080`.
src/
  app.js             # Express app configuration, middleware, and route mounting
  server.js          # HTTP server bootstrap
  config/            # Environment helpers (`env.js`) and database pool (`database.js`)
knexfile.js          # Knex configuration shared across environments
migrations/          # Raw SQL/Knex schema migrations (e.g., users table)
  modules/
    auth/
      controllers/   # Request handlers (e.g., signup, login)
      models/        # Data access layer (currently in-memory for demo purposes)
      services/      # Business logic
      routes/        # Express routers exposed by the module
      middleware/    # Validators and auth-specific middleware
```

## Endpoint Map

All `/api/rides`, `/api/drivers`, `/api/places`, and `/api/preferences` routes require a JWT via `Authorization: Bearer <token>`. `/api/auth/signup`, `/api/auth/login`, and `/api/health` are public. Admin simulation is public outside production and admin-only in production.

### Core App

Responsibility: Express bootstrap, shared middleware, CORS, route mounting, database health probe, 404 handling, and centralized error responses.

| Method | Endpoint | Auth | Responsibility |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Checks API/database availability with `SELECT 1`. |

### Auth Module

Responsibility: account registration, login, JWT issuance, password hashing, and current-user profile lookup.

| Method | Endpoint | Auth | Responsibility |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | Public | Creates a client or driver account and related profile row. |
| `POST` | `/api/auth/login` | Public | Validates credentials, updates login metadata, and returns a JWT. |
| `GET` | `/api/auth/me` | Authenticated | Returns the authenticated user's public profile. |

### Rides Module

Responsibility: ride lifecycle, assignment, driver invitations, state transitions, cancellation, no-show, requeue, ratings, ride visibility, and ride realtime emissions.

| Method | Endpoint | Roles | Responsibility |
| --- | --- | --- | --- |
| `POST` | `/api/rides` | `client`, `admin`, `operator` | Creates a ride request and initial ride event. Clients can only create for themselves. Admins can create for a provided `clientId`. Operators can create for a provided `clientId` or for a phone-only passenger. |
| `GET` | `/api/rides` | `client`, `driver`, `admin`, `operator` | Lists rides visible to the caller. |
| `GET` | `/api/rides/driver-invites` | `driver`, `admin`, `operator` | Lists driver invite records, usually pending invites for a driver. Admins/operators must provide `driverId`. |
| `GET` | `/api/rides/:rideId/driver-invites` | `admin`, `operator` | Lists all driver invites for one ride, optionally filtered with `statuses=pending,rejected,accepted,expired`. |
| `GET` | `/api/rides/:rideId/nearby-drivers` | `admin`, `operator` | Lists eligible online drivers near the ride pickup, filtered by recent location, active service type, availability, radius, and limit. |
| `GET` | `/api/rides/:rideId` | `client`, `driver`, `admin`, `operator` | Fetches ride details and event history if the caller can view the ride. |
| `PATCH` | `/api/rides/:rideId/assign` | `admin`, `operator` | Assigns a selected driver or invites nearby available drivers. |
| `PATCH` | `/api/rides/:rideId/driver-response` | `driver` | Lets an invited driver accept or reject a pending ride invite. |
| `POST` | `/api/rides/:rideId/claim` | `driver` | Atomically claims an available Hot Zones request. The driver must be online, recently present, free of another active ride, and enabled for the service type. On success it returns the assigned ride with exact passenger and pickup details. |
| `PATCH` | `/api/rides/:rideId/driver-progress` | `driver`, `admin` | Advances driver-owned ride progress states such as en route, arrived, in progress, completed, or driver cancel. |
| `PATCH` | `/api/rides/:rideId/status` | `client`, `driver`, `admin` | Generic state transition endpoint with actor validation. |
| `PATCH` | `/api/rides/:rideId/cancel` | `client`, `driver`, `admin` | Cancels a ride according to caller role and allowed state transitions. |
| `PATCH` | `/api/rides/:rideId/no-show` | `driver`, `admin` | Marks a ride as no-show when the driver has arrived. |
| `PATCH` | `/api/rides/:rideId/requeue` | `admin`, `operator` | Moves an assigned ride back to pending driver matching. |
| `PATCH` | `/api/rides/:rideId/system-cancel` | `admin` | Forces a system cancellation. |
| `POST` | `/api/rides/:rideId/rate` | `client`, `driver` | Creates a post-completion rating for the opposite party. |

Operator-created rides use the same ride creation endpoint and enter the normal
driver matching flow. If `autoAssign` is not disabled, the backend will create
the ride and then invite/assign nearby eligible drivers using the existing
assignment logic. Operator actions are recorded as ride events with
`actorType: "support"` and `actorId` set to the operator user id. The ride event
payload includes `createdByOperator`, `operatorId`, `source`, and passenger
metadata when the request came from a phone call.

When an operator creates a ride without `clientId`, the request must include a
phone number in `passenger.phoneNumber` or `passengerPhoneNumber`. The backend
first looks for an existing `client` user with that phone number. If none exists,
it creates a lightweight phone-only client account, stores
`profile.phoneOnly = true`, and uses the new user's id as `clientId`. This keeps
ride history, active-ride checks, reporting, and driver matching consistent even
when the passenger has not registered in the app.

### Drivers Module

Responsibility: driver availability, live driver position updates, and driver-side realtime location emissions.

| Method | Endpoint | Roles | Responsibility |
| --- | --- | --- | --- |
| `PATCH` | `/api/drivers/:driverId/location` | `driver`, `admin` | Records driver presence and optionally updates location, heading, and speed; drivers can only update themselves. An empty body is a heartbeat. |
| `PATCH` | `/api/drivers/:driverId/status` | `driver`, `admin` | Updates driver availability status; drivers can only update themselves. |
| `GET` | `/api/drivers/hot-zones` | `driver` | Returns sanitized demand-zone polygons and request metrics for the Flutter driver heat map. It never returns client identities, pickup addresses, exact requests, driver availability counts, or other driver records. |
| `GET` | `/api/drivers/hot-zones/:zoneId/requests` | `driver` | Returns paginated available requests with service type, request age, distance from the driver, and a server-generated approximate pickup circle. It excludes client identity, pickup address, and exact pickup coordinates. |

### Radio Module

WebRTC audio remains peer-to-peer. The backend stores queue/session metadata and
relays authenticated signaling only.

| Method | Endpoint | Roles | Responsibility |
| --- | --- | --- | --- |
| `POST` | `/api/radio/requests` | `driver` | Creates or returns the driver's existing pending operator-contact request. |
| `GET` | `/api/radio/requests/mine` | `driver` | Returns the driver's pending request. |
| `POST` | `/api/radio/requests/:requestId/cancel` | `driver` | Cancels the driver's pending request. |
| `GET` | `/api/radio/requests` | `operator`, `admin` | Lists the priority/FIFO request queue. |
| `POST` | `/api/radio/requests/:requestId/accept` | `operator` | Atomically accepts a request and creates a radio session. |
| `POST` | `/api/radio/requests/:requestId/reject` | `operator` | Rejects a pending request with an optional reason. |
| `POST` | `/api/radio/sessions` | `operator` | Creates a direct session with a reachable driver. |
| `GET` | `/api/radio/sessions/:sessionId` | participants, `admin` | Returns session metadata. |
| `GET` | `/api/radio/ice-config` | `driver`, `operator` | Returns configured STUN/TURN ICE servers. |

Socket.IO signaling events are `radio:offer`, `radio:answer`,
`radio:ice-candidate`, `radio:connected`, `radio:talk-start`,
`radio:talk-stop`, `radio:reply-start`, `radio:reply-stop`, `radio:mute`, and
`radio:end`. SDP and ICE payloads are never persisted.

### Driver Notifications Module

Responsibility: driver-originated operational alerts for operators and admins,
including the emergency panic button flow.

| Method | Endpoint | Roles | Responsibility |
| --- | --- | --- | --- |
| `POST` | `/api/driver-notifications/panic` | `driver` | Creates or returns the driver's recent active panic alert. The driver id is taken from the JWT. |
| `GET` | `/api/driver-notifications` | `operator`, `admin` | Lists notifications, defaulting to unread. Supports `status`, `type`, and `limit`. |
| `PATCH` | `/api/driver-notifications/:notificationId/acknowledge` | `operator`, `admin` | Marks an active notification as acknowledged by the current user. |
| `PATCH` | `/api/driver-notifications/:notificationId/resolve` | `operator`, `admin` | Resolves an active notification. |

Panic alerts are emitted through Socket.IO as
`operations:driver-panic-created` to both `operator` and `admin` role rooms.
Acknowledgement and resolution emit
`operations:driver-notification-acknowledged` and
`operations:driver-notification-resolved`.

The driver heat-map summary accepts `serviceType=all|<enabled-code>`. Each zone
contains `availableRequestsByService` and a total in
`metrics.availableRequests`. Zone request details accept `serviceType`, `page`
(default `1`), and `limit` (default `20`, maximum `50`).
Each request detail includes `approximatePickup.lat`, `approximatePickup.lng`,
and `approximatePickup.radiusMeters`. The center is snapped to a stable
250-meter server-side grid and is not the exact pickup coordinate.

### Places Module

Responsibility: authenticated places lookup facade over the configured external maps provider, normalizing autocomplete, details, and reverse geocode responses without exposing provider secrets.

| Method | Endpoint | Roles | Responsibility |
| --- | --- | --- | --- |
| `GET` | `/api/places/autocomplete` | `client`, `driver`, `admin` | Returns normalized place suggestions. |
| `GET` | `/api/places/details` | `client`, `driver`, `admin` | Returns normalized details for a selected place. |
| `GET` | `/api/places/reverse-geocode` | `client`, `driver`, `admin` | Resolves coordinates into a normalized place/address result. |

### Preferences Module

Responsibility: authenticated user preferences retrieval and partial updates.

| Method | Endpoint | Auth | Responsibility |
| --- | --- | --- | --- |
| `GET` | `/api/preferences` | Authenticated | Returns preferences for the authenticated user. |
| `PATCH` | `/api/preferences` | Authenticated | Validates and updates supported preference keys. |

### Admin Simulation Module

Responsibility: exposes simulator/runtime state for operational debugging. In production it requires admin authentication; outside production it is mounted without auth for local simulator workflows.

| Method | Endpoint | Auth | Responsibility |
| --- | --- | --- | --- |
| `GET` | `/api/admin/simulation/state` | Public outside production; `admin` in production | Returns the current admin simulation state. |

### Authentication

`/api/rides` and `/api/drivers` endpoints now require a JSON Web Token (JWT) in the `Authorization` header. Obtain the token via `POST /api/auth/login` (response contains `token` and `expiresIn`). Supply the token on subsequent requests:

```
Authorization: Bearer <token>
```

Configure the signing key via `JWT_SECRET` in your `.env` (defaults to `dev-insecure-jwt-secret`). Tokens expire after `JWT_ACCESS_TTL_SECONDS` (default `3600` seconds).

### CORS

Use the `CORS_ALLOWED_ORIGINS` environment variable to control which origins may call the API from the browser. The default configuration allows common local development origins (`http://localhost:3000`, `http://localhost:3001`, `http://localhost:5173`, and 127.0.0.1 equivalents). Add or override origins as a comma-separated list when needed.

### Sample Requests

Client signup:

```json
POST /api/auth/signup
{
  "email": "newclient@example.com",
  "password": "NewClientPass123!",
  "firstName": "Nora",
  "lastName": "Rider",
  "phoneNumber": "+10000000010",
  "accountType": "client",
  "clientProfile": {
    "defaultPaymentMethod": "card",
    "preferredLanguage": "en",
    "homeLocation": {
      "lat": 40.73061,
      "lng": -73.935242
    }
  }
}
```

Driver signup:

```json
POST /api/auth/signup
{
  "email": "newdriver@example.com",
  "password": "NewDriverPass123!",
  "firstName": "Derek",
  "lastName": "Driver",
  "phoneNumber": "+10000000011",
  "accountType": "driver",
  "driverProfile": {
    "licenseNumber": "DRV-567890",
    "vehicleMake": "Honda",
    "vehicleModel": "Civic",
    "vehicleYear": 2021,
    "vehicleColor": "Blue",
    "vehiclePlate": "XYZ-789",
    "vehicleType": "Sedan",
    "currentLocation": {
      "latitude": 34.052235,
      "longitude": -118.243683
    }
  }
}
```

Create ride (client):

```json
POST /api/rides
{
  "clientId": "<client-user-id>",
  "pickupAddress": "350 5th Ave, New York, NY",
  "dropoffAddress": "Times Square, New York, NY",
  "pickupLocation": { "lat": 40.748817, "lng": -73.985428 },
  "dropoffLocation": { "lat": 40.758, "lng": -73.9855 },
  "serviceType": "standard",
  "estimatedDistanceMeters": 1800,
  "estimatedDurationSeconds": 420,
  "estimatedFareAmount": 15.25,
  "surgeMultiplier": 1.2,
  "currency": "USD"
}
```

Create ride (operator, existing client):

```json
POST /api/rides
Authorization: Bearer <operator-token>
{
  "clientId": "<client-user-id>",
  "pickupAddress": "Calle 19 #10-20, Tunja",
  "dropoffAddress": "Terminal de Transportes, Tunja",
  "pickupLocation": { "lat": 5.5329, "lng": -73.3616 },
  "dropoffLocation": { "lat": 5.5452, "lng": -73.3578 },
  "serviceType": "standard",
  "requestDescription": "Servicio tomado por llamada telefónica",
  "metadata": {
    "source": "phone_call"
  }
}
```

Create ride (operator, phone-only passenger):

```json
POST /api/rides
Authorization: Bearer <operator-token>
{
  "passenger": {
    "phoneNumber": "+573001112233",
    "firstName": "Carlos",
    "lastName": "Pérez"
  },
  "pickupAddress": "Calle 19 #10-20, Tunja",
  "dropoffAddress": "Terminal de Transportes, Tunja",
  "pickupLocation": { "lat": 5.5329, "lng": -73.3616 },
  "dropoffLocation": { "lat": 5.5452, "lng": -73.3578 },
  "serviceType": "standard",
  "requestDescription": "Cliente no registrado; solicitud creada por operadora"
}
```

For operator-created rides, `clientId` is optional only when a phone number is
provided. If no client exists with that phone number, the API creates a
phone-only client account and then creates the ride. The response is the regular
ride creation response, including `ride`, initial `event`, and optional
`assignment`/`assignmentError` depending on driver availability.

For service types in the `delivery` category, the request must include a destination
and a delivery description:

```json
{
  "clientId": "<client-user-id>",
  "pickupAddress": "Sender address",
  "dropoffAddress": "Recipient address",
  "pickupLocation": { "lat": 40.748817, "lng": -73.985428 },
  "dropoffLocation": { "lat": 40.758, "lng": -73.9855 },
  "serviceType": "package_delivery",
  "requestDescription": "Small box with documents"
}
```

Assign nearest driver (automatic, admin/system):

```json
PATCH /api/rides/<ride-id>/assign
{}
```

Assign a specific driver:

```json
PATCH /api/rides/<ride-id>/assign
{
  "driverId": "<driver-user-id>",
  "actorType": "system"
}
```

List driver offers for a ride:

```http
GET /api/rides/<ride-id>/driver-invites?statuses=pending,rejected,accepted,expired
```

List assignable nearby drivers for a ride:

```http
GET /api/rides/<ride-id>/nearby-drivers?radiusMeters=5000&limit=10&excludeInvited=true
```

Driver responds to assignment:

```json
PATCH /api/rides/<ride-id>/driver-response
{
  "driverId": "<driver-user-id>",
  "action": "accept"
}
```

Driver updates progress (example: mark ride as completed):

```json
PATCH /api/rides/<ride-id>/driver-progress
{
  "driverId": "<driver-user-id>",
  "status": "completed",
  "actualDistanceMeters": 3200,
  "actualDurationSeconds": 780,
  "finalFareAmount": 22.5,
  "payload": { "tip": 3.0 }
}
```

Rate a completed ride (client rates driver, or driver rates client):

```json
POST /api/rides/<ride-id>/rate
{
  "stars": 5,
  "comment": "Great ride",
  "tags": ["clean", "safe"]
}
```

Login (works for seeded accounts):

```json
POST /api/auth/login
{
  "email": "client@example.com",
  "password": "TestPassword123!"
}
```

Update driver location:

```json
PATCH /api/drivers/<driver-id>/location
{
  "currentLocation": { "lat": 34.052235, "lng": -118.243683 },
  "heading": 90,
  "speedKmh": 35
}
```

Update driver status:

```json
PATCH /api/drivers/<driver-id>/status
{
  "status": "online"
}
```

## Timeout Jobs

The codebase now includes a timeout job runner at [src/modules/rides/jobs/ride-timeouts.job.js](/Users/andresyanquen/Documents/Projects/taxiPostgres/src/modules/rides/jobs/ride-timeouts.job.js) backed by [src/modules/rides/services/ride-jobs.service.js](/Users/andresyanquen/Documents/Projects/taxiPostgres/src/modules/rides/services/ride-jobs.service.js). It can sweep rides for:

- `pending_driver` timeouts -> `canceled_by_system`
- `driver_assigned` timeouts -> `pending_driver`
- `driver_arrived` timeouts -> `no_show`

`GET /health` is provided by the core app for health checks.

## Adding New Modules

1. Duplicate the auth module structure inside `src/modules/<module-name>/`.
2. Implement the necessary controllers, services, models, routes, and middleware.
3. Export an Express router from `routes/<module>.routes.js`.
4. Import and mount the router in `src/app.js`, e.g.:
   ```js
   const exampleRoutes = require("./modules/example/routes/example.routes");
   app.use("/api/example", exampleRoutes);
   ```

This keeps the module boundaries clear while avoiding intermediate registry files.
