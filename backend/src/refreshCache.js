// One refresh per process, bounded refresh frequency even after partial failures.
function createRefreshCache(refresh, { ttlMs = 60_000, failureTtlMs = 30_000,
  now = Date.now } = {}) {
  let cached;
  let expiresAt = 0;
  let retryAt = 0;
  let inFlight;
  let lastError;
  return async function get({ force = false } = {}) {
    if (!force && cached !== undefined && now() < expiresAt) return cached;
    if (inFlight) return inFlight;
    if (now() < retryAt) {
      if (cached !== undefined) return cached;
      throw lastError;
    }
    // A forced refresh never bypasses the minimum upstream refresh interval.
    if (force && cached !== undefined && now() < expiresAt) return cached;
    inFlight = Promise.resolve().then(refresh).then(value => {
      cached = value;
      expiresAt = now() + ttlMs;
      retryAt = expiresAt;
      return value;
    }, error => {
      lastError = error;
      retryAt = now() + failureTtlMs;
      if (cached !== undefined) return cached;
      throw error;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
}

module.exports = { createRefreshCache };
