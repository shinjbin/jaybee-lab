const crypto = require("crypto");

const MIN_ADMIN_API_KEY_LENGTH = 32;

function extractAdminCredential(req) {
  const explicitKey = req.get("x-admin-api-key");

  if (explicitKey) {
    return explicitKey.trim();
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
}

function safeEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();

  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function createAdminAuthMiddleware(expectedApiKey) {
  return function requireAdminApiKey(req, res, next) {
    if (
      !expectedApiKey ||
      String(expectedApiKey).length < MIN_ADMIN_API_KEY_LENGTH ||
      /^replace[_-]/i.test(String(expectedApiKey))
    ) {
      return res.status(503).json({
        error: "Administrative API access is not configured."
      });
    }

    const providedApiKey = extractAdminCredential(req);

    if (!providedApiKey || !safeEqual(providedApiKey, expectedApiKey)) {
      res.set("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "Unauthorized." });
    }

    return next();
  };
}

function securityHeaders(_req, res, next) {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  next();
}

function createApiCapacityMiddleware({ maxConcurrent = 40, requestsPerSecond = 100,
  now = Date.now } = {}) {
  const lanes = { api: { active: 0, requests: 0 }, health: { active: 0, requests: 0 } };
  let windowStart = now();
  return (req, res, next) => {
    // Reserve bounded probe capacity; public /health cannot bypass all limits.
    const health = req.path === "/health";
    const lane = lanes[health ? "health" : "api"];
    if (now() - windowStart >= 1000) {
      windowStart = now(); lanes.api.requests = 0; lanes.health.requests = 0;
    }
    if (++lane.requests > (health ? 10 : requestsPerSecond) ||
        lane.active >= (health ? 2 : maxConcurrent)) {
      res.set("Retry-After", "1");
      return res.status(429).json({ error: "API capacity exceeded. Try again later." });
    }
    lane.active++;
    let released = false;
    const release = () => { if (!released) { released = true; lane.active--; } };
    res.once("finish", release);
    res.once("close", release);
    return next();
  };
}

module.exports = {
  MIN_ADMIN_API_KEY_LENGTH,
  createAdminAuthMiddleware,
  extractAdminCredential,
  safeEqual,
  securityHeaders,
  createApiCapacityMiddleware
};
