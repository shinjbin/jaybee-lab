const { Pool } = require("pg");

const config = require("./config");
const schemaSql = require("./schema");

const pool = new Pool({
  connectionString: config.databaseUrl
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
  await query("SELECT 1");
  await query(schemaSql);
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
  initializeDatabaseWithRetry,
  closePool
};
