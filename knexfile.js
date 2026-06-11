require("dotenv").config();

const {
  DB_HOST = "localhost",
  DB_PORT = 5432,
  DB_NAME = "postgres",
  DB_USER = "postgres",
  DB_PASSWORD = "",
  DB_SSL = "false",
  DB_SSL_REJECT_UNAUTHORIZED = "false",
  DB_CONNECTION_TIMEOUT_MS = 5000,
  DB_POOL_MAX = 10,
} = process.env;

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

const baseConfig = {
  client: "pg",
  connection: {
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
  migrations: {
    tableName: "knex_migrations",
    directory: "./migrations",
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
