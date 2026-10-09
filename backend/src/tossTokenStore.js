const { createHash } = require("node:crypto");

// Toss allows one valid token per client. Coordinate issuance across API/worker
// processes using the shared database, including during rolling deployments.
function createTokenStore(pool, key) {
  return async function getToken(issueToken, rejectedToken = null) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      const { rows } = await client.query(
        "SELECT access_token, expires_at FROM brokerage_api_tokens WHERE cache_key = $1",
        [key]
      );
      let token = rows[0];
      if (!token || token.access_token === rejectedToken ||
          new Date(token.expires_at).getTime() <= Date.now() + 60000) {
        const issued = await issueToken();
        token = { access_token: issued.access_token, expires_at: new Date(Date.now() + issued.expires_in * 1000) };
        await client.query(
          `INSERT INTO brokerage_api_tokens (cache_key, access_token, expires_at)
           VALUES ($1, $2, $3) ON CONFLICT (cache_key) DO UPDATE
           SET access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at`,
          [key, token.access_token, token.expires_at]
        );
      }
      await client.query("COMMIT");
      return token.access_token;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}

function tokenCacheKey(config) {
  return createHash("sha256")
    .update(JSON.stringify([config.tossBaseUrl, config.tossClientId, config.tossClientSecret]))
    .digest("hex");
}

module.exports = { createTokenStore, tokenCacheKey };
