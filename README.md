# Taxi Backend

Modular Node.js backend powered by Express. Features a pluggable module system with dedicated sub-folders for controllers, services, models, routes, and middleware. The first module implemented is `auth`, which demonstrates the expected layout.

## Getting Started

```bash
npm install
cp .env.example .env
npm run dev
```

Run database migrations before starting the server:

```bash
npm run migrate:latest
```

Seed the database with a demo user (email `demo@example.com`, password `TestPassword123!`):

```bash
npm run seed:run
```

Seed data creates an admin plus sample client (`client@example.com`) and driver (`driver@example.com`) accounts. All seeded users share the password `TestPassword123!`.

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
- `POST /api/auth/login` – Validates credentials against the database, updates `last_login_at`, and returns a session token placeholder along with profile data.

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
    "preferredLanguage": "en"
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
    "vehicleType": "Sedan"
  }
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
