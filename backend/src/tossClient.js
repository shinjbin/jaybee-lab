const config = require("./config");
const { createTokenStore, tokenCacheKey } = require("./tossTokenStore");

// Source: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
function createTossClient(options = {}) {
  const settings = options.config || config;
  const fetchImpl = options.fetch || ((...args) => fetch(...args));
  let tokenStore = options.tokenStore;
  let requestQueue = Promise.resolve();
  let nextRequestAt = 0;

  async function issueToken() {
    const response = await fetchImpl(`${settings.tossBaseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: settings.tossClientId, client_secret: settings.tossClientSecret }).toString(),
      signal: AbortSignal.timeout(settings.tossRequestTimeoutMs)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token || !Number.isFinite(Number(payload.expires_in)) || Number(payload.expires_in) <= 0) {
      throw new Error(`Toss token issuance failed (${response.status})`);
    }
    return payload;
  }

  async function getAccessToken(rejectedToken = null) {
    if (!settings.tossEnabled) throw new Error("TOSS_CLIENT_ID and TOSS_CLIENT_SECRET are required.");
    tokenStore ||= createTokenStore(require("./db").pool, tokenCacheKey(settings));
    return tokenStore(issueToken, rejectedToken);
  }

  function waitForRequestSlot() {
    const slot = requestQueue.then(async () => {
      const delay = Math.max(0, nextRequestAt - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      nextRequestAt = Date.now() + settings.tossRequestIntervalMs;
    });
    requestQueue = slot.catch(() => {});
    return slot;
  }

  async function fetchTossJson(path, params = {}) {
    const url = new URL(`${settings.tossBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    let token = await getAccessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      await waitForRequestSlot();
      const response = await fetchImpl(url.toString(), {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(settings.tossRequestTimeoutMs)
      });
      if (response.status === 401 && attempt === 0) {
        token = await getAccessToken(token);
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.error) {
        throw new Error(`Toss request failed (${response.status}): ${payload?.error?.code || "unknown-error"}`);
      }
      if (!payload || !("result" in payload)) throw new Error("Toss response is missing result.");
      return payload.result;
    }
  }

  async function fetchCurrentPrice(stockCode) {
    const rows = await fetchTossJson("/api/v1/prices", { symbols: stockCode });
    if (!Array.isArray(rows)) throw new Error("Invalid Toss prices response.");
    return rows.find((row) => row.symbol === stockCode) || null;
  }

  async function fetchInvestorTradeByStockDaily(stockCode, until) {
    const result = await fetchTossJson(`/api/v1/stocks/${encodeURIComponent(stockCode)}/investor-trading`, { until, count: 2 });
    if (!Array.isArray(result?.records)) throw new Error("Invalid Toss investor trading response.");
    return result.records;
  }

  async function fetchStockClosingPrice(stockCode, date) {
    const result = await fetchTossJson("/api/v1/candles", {
      symbol: stockCode, interval: "1d", count: 1, adjusted: false, before: `${date}T23:59:59+09:00`
    });
    return result?.candles?.find((row) => row.timestamp.slice(0, 10) === date)?.closePrice || null;
  }

  async function fetchIndexPrice() {
    const rows = await fetchTossJson("/api/v1/market-indicators/prices", { symbols: "KOSPI" });
    if (!Array.isArray(rows)) throw new Error("Invalid Toss index prices response.");
    return rows.find((row) => row.symbol === "KOSPI") || null;
  }

  async function fetchIndexDailyChartPrice() {
    const candles = new Map();
    let before;
    const seen = new Set();
    while (candles.size < settings.tossIndexHistoryDays + 1) {
      const result = await fetchTossJson("/api/v1/market-indicators/KOSPI/candles", {
        interval: "1d", count: Math.min(200, settings.tossIndexHistoryDays + 1 - candles.size), before
      });
      if (!Array.isArray(result?.candles)) throw new Error("Invalid Toss index candles response.");
      result.candles.forEach((row) => candles.set(row.timestamp, row));
      if (!result.candles.length || !result.nextBefore || seen.has(result.nextBefore)) break;
      before = result.nextBefore;
      seen.add(before);
    }
    return [...candles.values()];
  }

  return { getAccessToken, fetchCurrentPrice, fetchInvestorTradeByStockDaily,
    fetchStockClosingPrice, fetchIndexPrice, fetchIndexDailyChartPrice };
}

module.exports = { createTossClient, ...createTossClient() };
