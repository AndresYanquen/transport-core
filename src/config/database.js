const { Pool } = require("pg");

const { env, formatPostgresSearchPath } = require("./env");

const searchPath = formatPostgresSearchPath(env.db.searchPath);

const pool = new Pool({
  connectionString: env.db.connectionString || undefined,
  host: env.db.connectionString ? undefined : env.db.host,
  port: env.db.connectionString ? undefined : env.db.port,
  database: env.db.connectionString ? undefined : env.db.database,
  user: env.db.connectionString ? undefined : env.db.user,
  password: env.db.connectionString ? undefined : env.db.password,
  ssl: env.db.ssl
    ? {
        rejectUnauthorized: env.db.rejectUnauthorized,
      }
    : false,
  connectionTimeoutMillis: env.db.connectionTimeoutMillis,
  idleTimeoutMillis: env.db.idleTimeoutMillis,
  max: env.db.poolMax,
  options: searchPath ? `-c search_path=${searchPath}` : undefined,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error", err);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
};
