# Coolify Deployment

This repository is set up for Coolify with Docker Compose and Supabase PostgreSQL. The production stack runs:

- `redis`: Redis with a persistent Docker volume.
- `backend`: Node/Express API and Socket.IO server.
- `admin-client`: Vue/Vite admin frontend served by Nginx.
- `migrate`: one-off migration service behind the `release` compose profile.

PostgreSQL is external and should be provided by Supabase.

## Coolify setup

1. Create a new Coolify project and resource from the Git repository.
2. Select Docker Compose as the build/deploy mode.
3. Use `docker-compose.yml` from the repository root.
4. Add the environment variables from `.env.coolify.example` in Coolify.
5. Configure public domains:
   - API/backend service: map to container port `3000`.
   - Admin frontend service: map to container port `80` through the `admin-client` service.
6. Set `CORS_ALLOWED_ORIGINS` to the exact frontend URL, for example `https://admin.example.com`.
7. Set `VITE_API_BASE_URL` to the exact backend URL, for example `https://api.example.com`.
8. Set `DATABASE_URL` to the Supabase PostgreSQL connection string.
9. Deploy the stack.
10. Run database migrations once after the first deploy and after every migration change.

## Supabase database

Use Supabase's PostgreSQL connection string, preferably the Session pooler URI for server-side apps. Set:

```sh
DATABASE_URL=postgresql://postgres.project-ref:password@aws-0-region.pooler.supabase.com:5432/postgres
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
DB_SEARCH_PATH=public
```

You can also use separate variables instead of `DATABASE_URL`:

```sh
DB_HOST=aws-0-region.pooler.supabase.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres.project-ref
DB_PASSWORD=your-supabase-password
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
DB_SEARCH_PATH=public
```

If both `DATABASE_URL` and separate `DB_*` variables are set, the app uses `DATABASE_URL`.
`DB_SEARCH_PATH=public` forces Knex migrations, migration lock tables, and application queries to resolve unqualified tables in the `public` schema.

## Required production environment

Set these variables in the hosting platform before starting the API:

- `NODE_ENV=production`
- `DATABASE_URL` or the separate `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` variables
- `DB_SSL=true`
- `DB_SEARCH_PATH=public`
- `JWT_SECRET`
- `CORS_ALLOWED_ORIGINS`
- `VITE_API_BASE_URL`

`REDIS_URL` and `PORT` are set by `docker-compose.yml` for Coolify. `JWT_SECRET`, database settings, and `CORS_ALLOWED_ORIGINS` are validated at startup in production. The process exits if any are missing.

Optional deployment tuning variables:

- `LOG_LEVEL`
- `HTTP_TRUST_PROXY`
- `HTTP_JSON_BODY_LIMIT`
- `HTTP_REQUEST_LOGS_ENABLED`
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `SHUTDOWN_TIMEOUT_MS`
- `REDIS_URL`
- `REDIS_CONNECT_TIMEOUT_MS`
- `REDIS_MAX_RECONNECT_DELAY_MS`
- `GOOGLE_MAPS_API_KEY`

## Release order

Run deployment steps in this order:

1. Push code to the deploy branch.
2. Let Coolify build and deploy the stack.
3. Run `npm run migrate:latest` through the `migrate` service.
4. Confirm `GET /api/ready` returns success.

Run migrations as a release step, not inside every web process. This avoids multiple app instances trying to modify schema at the same time.

With the compose profile locally, the equivalent migration command is:

```sh
docker compose --profile release run --rm migrate
```

In Coolify, run the same one-off command against the `migrate` service or open a terminal in the backend container and run:

```sh
npm run migrate:latest
```

## Health checks

- `GET /api/live`: process liveness, no database probe.
- `GET /api/ready`: readiness with PostgreSQL probe.
- `GET /api/health`: compatibility alias for readiness.

Use `/api/live` for liveness checks and `/api/ready` for load balancer readiness checks.

## Local Docker smoke test

For a production-like local smoke test against Supabase, copy the Coolify env template and fill the required values:

```sh
cp .env.coolify.example .env
docker compose up --build
```

Then run migrations:

```sh
docker compose --profile release run --rm migrate
```

The admin frontend will be available on `http://localhost:8080` and the backend on `http://localhost:3000`. Make sure Supabase allows the connection from your machine or server.

## Manual image builds

```sh
docker build -t taxi-backend .
docker build -t taxi-admin-client ./client
```

Override the API URL at frontend build time:

```sh
docker build \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  --build-arg VITE_SOCKET_PATH=/socket.io \
  -t taxi-admin-client \
  ./client
```

## Scaling notes

This backend includes Socket.IO plus in-process workers. Before running more than one web instance, move recurring workers to a dedicated worker process or protect them with database locks, and add a shared Socket.IO adapter such as Redis.
