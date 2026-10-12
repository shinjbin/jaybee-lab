const { Pool } = require("pg");

const config = require("./config");
const pool = new Pool({
  ...(config.databaseUrl ? { connectionString: config.databaseUrl } : {
    host: config.databaseHost, database: config.databaseName,
    user: config.databaseUser, password: config.databasePassword
  }),
  max: 10,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 15_000
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function query(text, params) {
  return pool.query(text, params);
}

async function initializeDatabase() {
  const { rows } = await query(
    `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
     FROM pg_roles WHERE rolname = current_user`
  );
  if (!rows[0] || Object.values(rows[0]).some(Boolean)) {
    throw new Error("Backend database role must have no administrative privileges.");
  }
  // No DDL from a serving process. Migrations run separately with owner access.
  await query("SELECT 1 FROM news_articles LIMIT 0");
  await query("SELECT 1 FROM brokerage_api_tokens LIMIT 0");
}

async function initializeDatabaseWithRetry() {
  let lastError = null;

  for (let attempt = 1; attempt <= config.databaseInitRetries; attempt += 1) {
    try {
      await initializeDatabase();
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `Database init attempt ${attempt}/${config.databaseInitRetries} failed: ${error.message}`
      );
      await sleep(config.databaseRetryDelayMs);
    }
  }

  throw lastError;
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  initializeDatabase,
  initializeDatabaseWithRetry,
  closePool
};
