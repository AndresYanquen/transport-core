require("dotenv").config();

const {
  DATABASE_URL = "",
  DB_HOST = "localhost",
  DB_PORT = 5432,
  DB_NAME = "postgres",
  DB_USER = "postgres",
  DB_PASSWORD = "",
  DB_SSL = "false",
  DB_SSL_REJECT_UNAUTHORIZED = "false",
  DB_SEARCH_PATH = "public",
  DB_CONNECTION_TIMEOUT_MS = 5000,
  DB_POOL_MAX = 10,
} = process.env;

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseSearchPath(value) {
  return String(value)
    .split(",")
    .map((schema) => schema.trim())
    .filter(Boolean);
}

const searchPath = parseSearchPath(DB_SEARCH_PATH);

const baseConfig = {
  client: "pg",
  connection: DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        ssl: parseBoolean(DB_SSL)
          ? {
              rejectUnauthorized: parseBoolean(DB_SSL_REJECT_UNAUTHORIZED),
            }
          : false,
        connectionTimeoutMillis: Number(DB_CONNECTION_TIMEOUT_MS),
      }
    : {
        host: DB_HOST,
        port: Number(DB_PORT),
        database: DB_NAME,
        user: DB_USER,
        password: DB_PASSWORD,
        ssl: parseBoolean(DB_SSL)
          ? {
              rejectUnauthorized: parseBoolean(DB_SSL_REJECT_UNAUTHORIZED),
            }
          : false,
        connectionTimeoutMillis: Number(DB_CONNECTION_TIMEOUT_MS),
      },
  pool: {
    min: 0,
    max: Number(DB_POOL_MAX),
  },
  searchPath,
  migrations: {
    tableName: "knex_migrations",
    directory: "./migrations",
    schemaName: "public",
    extension: "js",
  },
  seeds: {
    directory: "./seeds",
    extension: "js",
  },
};

module.exports = {
  development: { ...baseConfig },
  production: { ...baseConfig },
  test: { ...baseConfig },
};
