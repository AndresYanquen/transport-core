require("dotenv").config();

const {
  DB_HOST = "localhost",
  DB_PORT = 5432,
  DB_NAME = "postgres",
  DB_USER = "postgres",
  DB_PASSWORD = "",
} = process.env;

const baseConfig = {
  client: "pg",
  connection: {
    host: DB_HOST,
    port: Number(DB_PORT),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  },
  pool: {
    min: 2,
    max: 10,
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
