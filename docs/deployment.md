# Backend Deployment

## Required production environment

Set these variables in the hosting platform before starting the API:

- `NODE_ENV=production`
- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL`
- `JWT_SECRET`
- `CORS_ALLOWED_ORIGINS`

`JWT_SECRET`, database settings, and `CORS_ALLOWED_ORIGINS` are validated at startup in production. The process exits if any are missing.

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

## Release order

Run deployment steps in this order:

1. `npm ci`
2. `npm test`
3. `npm run migrate:latest`
4. `npm start`

Run migrations as a release step, not inside every web process. This avoids multiple app instances trying to modify schema at the same time.

## Health checks

- `GET /api/live`: process liveness, no database probe.
- `GET /api/ready`: readiness with PostgreSQL probe.
- `GET /api/health`: compatibility alias for readiness.

Use `/api/live` for liveness checks and `/api/ready` for load balancer readiness checks.

## Docker

Build backend:

```sh
docker build -t taxi-backend .
```

Run backend against PostgreSQL on the host machine:

```sh
docker run --env-file .env -e DB_HOST=host.docker.internal -p 3000:3000 taxi-backend
```

Run migrations separately:

```sh
docker run --env-file .env -e DB_HOST=host.docker.internal taxi-backend npm run migrate:latest
```

Build frontend:

```sh
docker build -t taxi-admin-client ./client
```

Run frontend:

```sh
docker run -p 8080:80 taxi-admin-client
```

Override the API URL at frontend build time:

```sh
docker build \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  --build-arg VITE_SOCKET_PATH=/socket.io \
  -t taxi-admin-client \
  ./client
```

Run backend and frontend together:

```sh
docker compose up --build
```

The Compose setup includes Redis and overrides the backend with `REDIS_URL=redis://redis:6379`. If you run the backend container manually and Redis is running on your host machine, use `-e REDIS_URL=redis://host.docker.internal:6379`. When `REDIS_URL` is set, Socket.IO and auth rate limiting use Redis for cross-instance coordination.

## Scaling notes

This backend includes Socket.IO plus in-process workers. Before running more than one web instance, move recurring workers to a dedicated worker process or protect them with database locks, and add a shared Socket.IO adapter such as Redis.
