const config = require("./config");
const { cleanupText } = require("./utils");

function buildUrl(path, params = {}) {
  const url = new URL(`${config.fmpBaseUrl}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  if (config.fmpApiKey) {
    url.searchParams.set("apikey", config.fmpApiKey);
  }

  return url;
}

async function fetchJson(path, params) {
  const url = buildUrl(path, params);
  const response = await fetch(url, {
    headers: {
      "User-Agent": config.collectorUserAgent,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(
      `FMP market index request failed (${response.status}): ${cleanupText(payload).slice(0, 240)}`
    );
  }

  return response.json();
}

function normalizeQuote(symbolConfig, payload) {
  const row = Array.isArray(payload) ? payload[0] : payload;
  const price = Number(row?.price ?? row?.last ?? row?.close ?? 0);
  const change = Number(row?.change ?? 0);
  const changesPercentage = Number(
    row?.changesPercentage ?? row?.changePercentage ?? row?.changesPercentageDaily ?? 0
  );

  return {
    symbol: symbolConfig.symbol,
    name: symbolConfig.name,
    market: symbolConfig.market,
    price: Number.isFinite(price) ? price : null,
    change: Number.isFinite(change) ? change : null,
    changesPercentage: Number.isFinite(changesPercentage) ? changesPercentage : null,
    volume: Number(row?.volume ?? 0) || null,
    updatedAt: new Date().toISOString()
  };
}

function normalizeHistory(payload) {
  const rows = Array.isArray(payload?.historical)
    ? payload.historical
    : Array.isArray(payload)
      ? payload
      : [];

  return rows
    .map((item) => ({
      date: item.date,
      close: Number(item.close ?? item.price ?? item.value)
    }))
    .filter((item) => item.date && Number.isFinite(item.close))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-config.fmpIndexHistoryDays);
}

async function fetchIndexSnapshot(symbolConfig) {
  const [quotePayload, historyPayload] = await Promise.all([
    fetchJson("/quote", { symbol: symbolConfig.symbol }),
    fetchJson("/historical-price-eod/light", {
      symbol: symbolConfig.symbol,
      limit: config.fmpIndexHistoryDays
    })
  ]);

  return {
    ...normalizeQuote(symbolConfig, quotePayload),
    history: normalizeHistory(historyPayload)
  };
}

async function getMarketIndices() {
  const items = await Promise.all(
    config.fmpIndexSymbols.map((symbolConfig) => fetchIndexSnapshot(symbolConfig))
  );

  return {
    generatedAt: new Date().toISOString(),
    items
  };
}

module.exports = {
  getMarketIndices
};
