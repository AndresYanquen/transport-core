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

## Available Endpoints

`auth` module:

- `POST /api/auth/signup` – Hashes the password, stores the user in PostgreSQL (as a client or driver), inserts role-specific records, and returns verification tokens you can deliver via email/SMS.
- `POST /api/auth/login` – Validates credentials against the database, updates `last_login_at`, and returns a signed JWT access token alongside profile data.

### Authentication

`/api/rides` and `/api/drivers` endpoints now require a JSON Web Token (JWT) in the `Authorization` header. Obtain the token via `POST /api/auth/login` (response contains `token` and `expiresIn`). Supply the token on subsequent requests:

```
Authorization: Bearer <token>
```

Configure the signing key via `JWT_SECRET` in your `.env` (defaults to `dev-insecure-jwt-secret`). Tokens expire after `JWT_ACCESS_TTL_SECONDS` (default `3600` seconds).

### CORS

Use the `CORS_ALLOWED_ORIGINS` environment variable to control which origins may call the API from the browser. The default configuration allows common local development origins (`http://localhost:3000`, `http://localhost:3001`, `http://localhost:5173`, and 127.0.0.1 equivalents). Add or override origins as a comma-separated list when needed.

`rides` module (basic MVP):

- `POST /api/rides` – Client creates a ride request with pickup/dropoff coordinates; stores PostGIS points and records the initial ride event.
- `GET /api/rides` – Lists rides visible to the authenticated actor. Clients only see their own rides; drivers only see rides assigned to them.
- `PATCH /api/rides/:rideId/assign` – Moves a ride into the matching queue if needed and sends invites to a selected or nearby online driver.
- `PATCH /api/rides/:rideId/driver-response` – Driver accepts or rejects the invitation.
- `PATCH /api/rides/:rideId/driver-progress` – Driver advances ride status (`driver_en_route`, `driver_arrived`, `in_progress`, `completed`, `canceled_by_driver`).
- `PATCH /api/rides/:rideId/cancel` – Cancels the ride as `canceled_by_client`, `canceled_by_driver`, or `canceled_by_system` depending on the caller role.
- `PATCH /api/rides/:rideId/no-show` – Marks a ride as `no_show` from `driver_arrived`.
- `PATCH /api/rides/:rideId/requeue` – Admin/system command to move a `driver_assigned` ride back to `pending_driver`.
- `PATCH /api/rides/:rideId/system-cancel` – Admin/system command to force `canceled_by_system`.
- `GET /api/rides/:rideId` – Fetch ride details plus event history.

`drivers` module:

- `PATCH /api/drivers/:driverId/location` – Updates the driver's PostGIS location, heading, and speed.
- `PATCH /api/drivers/:driverId/status` – Changes driver availability (`offline`, `online`, `busy`, `unavailable`).

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
