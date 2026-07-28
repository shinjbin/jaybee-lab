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
      String(expectedApiKey).length < MIN_ADMIN_API_KEY_LENGTH
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

module.exports = {
  MIN_ADMIN_API_KEY_LENGTH,
  createAdminAuthMiddleware,
  extractAdminCredential,
  safeEqual,
  securityHeaders
};
