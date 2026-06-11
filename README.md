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

## Project Structure

```
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
| `POST` | `/api/rides` | `client`, `admin` | Creates a ride request and initial ride event; clients can only create for themselves. |
| `GET` | `/api/rides` | `client`, `driver`, `admin` | Lists rides visible to the caller. |
| `GET` | `/api/rides/driver-invites` | `driver`, `admin` | Lists driver invite records, usually pending invites for a driver. |
| `GET` | `/api/rides/:rideId` | `client`, `driver`, `admin` | Fetches ride details and event history if the caller can view the ride. |
| `PATCH` | `/api/rides/:rideId/assign` | `admin` | Assigns a selected driver or invites nearby available drivers. |
| `PATCH` | `/api/rides/:rideId/driver-response` | `driver` | Lets an invited driver accept or reject a pending ride invite. |
| `PATCH` | `/api/rides/:rideId/driver-progress` | `driver`, `admin` | Advances driver-owned ride progress states such as en route, arrived, in progress, completed, or driver cancel. |
| `PATCH` | `/api/rides/:rideId/status` | `client`, `driver`, `admin` | Generic state transition endpoint with actor validation. |
| `PATCH` | `/api/rides/:rideId/cancel` | `client`, `driver`, `admin` | Cancels a ride according to caller role and allowed state transitions. |
| `PATCH` | `/api/rides/:rideId/no-show` | `driver`, `admin` | Marks a ride as no-show when the driver has arrived. |
| `PATCH` | `/api/rides/:rideId/requeue` | `admin` | Moves an assigned ride back to pending driver matching. |
| `PATCH` | `/api/rides/:rideId/system-cancel` | `admin` | Forces a system cancellation. |
| `POST` | `/api/rides/:rideId/rate` | `client`, `driver` | Creates a post-completion rating for the opposite party. |

### Drivers Module

Responsibility: driver availability, live driver position updates, and driver-side realtime location emissions.

| Method | Endpoint | Roles | Responsibility |
| --- | --- | --- | --- |
| `PATCH` | `/api/drivers/:driverId/location` | `driver`, `admin` | Updates current location, heading, and speed; drivers can only update themselves. |
| `PATCH` | `/api/drivers/:driverId/status` | `driver`, `admin` | Updates driver availability status; drivers can only update themselves. |

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
