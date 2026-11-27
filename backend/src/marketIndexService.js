const config = require("./config");
const { query } = require("./db");
const { fetchIndexDailyChartPrice, fetchIndexPrice } = require("./tossClient");
const { cleanupText } = require("./utils");
const { createRefreshCache } = require("./refreshCache");

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  const number = Number(normalized);

  return Number.isFinite(number) ? number : null;
}

function pickValue(source, candidates) {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const entries = Object.entries(source);

  for (const candidate of candidates) {
    const direct = source[candidate];

    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return direct;
    }

    const normalizedCandidate = candidate.toLowerCase();
    const matched = entries.find(([key, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") {
        return false;
      }

      return key.toLowerCase() === normalizedCandidate;
    });

    if (matched) {
      return matched[1];
    }
  }

  return undefined;
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();

  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  if (/^\d{4}-\d{2}-\d{2} /.test(normalized)) {
    return normalized.slice(0, 10);
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function buildTwelveDataUrl(path, params = {}) {
  const url = new URL(`${config.twelveDataBaseUrl}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  if (config.twelveDataApiKey) {
    url.searchParams.set("apikey", config.twelveDataApiKey);
  }

  return url;
}

async function fetchTwelveDataJson(path, params) {
  const url = buildTwelveDataUrl(path, params);
  const response = await fetch(url, {
    headers: {
      "User-Agent": config.collectorUserAgent,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.status === "error") {
    throw new Error(
      cleanupText(
        payload?.message ||
          payload?.code ||
          `Twelve Data request failed (${response.status}).`
      )
    );
  }

  return payload;
}

function normalizeTossHistory(rows) {
  return rows.map((row) => ({ date: parseDateValue(row.timestamp), open: parseNumber(row.openPrice),
    high: parseNumber(row.highPrice), low: parseNumber(row.lowPrice), close: parseNumber(row.closePrice) }))
    .filter((row) => row.date && row.close !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeTwelveHistory(payload) {
  const rows = Array.isArray(payload?.values) ? payload.values : [];

  return rows
    .map((row) => ({
      date: parseDateValue(row.datetime || row.date),
      open: parseNumber(row.open),
      high: parseNumber(row.high),
      low: parseNumber(row.low),
      close: parseNumber(row.close)
    }))
    .filter((row) => row.date && row.close !== null)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-config.twelveDataHistoryDays);
}

async function fetchTossKoreanIndexItem(saved) {
  const [current, candles] = await Promise.all([fetchIndexPrice(), fetchIndexDailyChartPrice({ count: incrementalCount(saved, config.tossIndexHistoryDays) })]);
  const allHistory = mergeHistory(saved?.history, normalizeTossHistory(candles), config.tossIndexHistoryDays);
  const latest = allHistory.at(-1);
  const price = parseNumber(current?.lastPrice) ?? latest?.close ?? null;
  if (price === null) throw new Error("Toss index response did not include a usable KOSPI price.");
  const priceDate = current?.timestamp?.slice(0, 10) || latest?.date;
  const previous = allHistory.filter((row) => row.date < priceDate).at(-1);
  return {
    symbol: "KOSPI", name: "KOSPI", market: "KR", provider: "Toss Securities",
    sourceSymbol: "KOSPI", instrumentType: "Index", historyLimit: config.tossIndexHistoryDays,
    price, change: previous ? price - previous.close : null,
    changesPercentage: previous?.close ? ((price - previous.close) / previous.close) * 100 : null,
    updatedAt: current?.timestamp || candles.find((row) => row.timestamp?.startsWith(latest?.date))?.timestamp || null,
    history: allHistory.slice(-config.tossIndexHistoryDays)
  };
}

async function fetchTwelveSeriesItem(itemConfig, saved) {
  const historyPayload = await fetchTwelveDataJson("/time_series", {
    symbol: itemConfig.symbol,
    interval: "1day",
    outputsize: incrementalCount(saved, config.twelveDataHistoryDays),
    order: "ASC"
  });

  const freshHistory = normalizeTwelveHistory(historyPayload);
  if (!freshHistory.length) throw new Error(`Twelve Data returned no history for ${itemConfig.symbol}.`);
  const history = mergeHistory(saved?.history, freshHistory, config.twelveDataHistoryDays);
  const latest = history[history.length - 1] || null;
  const previous = history[history.length - 2] || null;

  if (!latest) {
    throw new Error(`Twelve Data returned no history for ${itemConfig.symbol}.`);
  }

  const change = previous ? latest.close - previous.close : null;
  const changesPercentage = previous && previous.close
    ? ((latest.close - previous.close) / previous.close) * 100
    : null;

  return {
    symbol: itemConfig.displaySymbol || itemConfig.symbol,
    name: itemConfig.name,
    market: itemConfig.market,
    provider: "Twelve Data",
    sourceSymbol: itemConfig.symbol,
    instrumentType: ["QQQ", "DIA", "SPY"].includes(itemConfig.symbol) ? "ETF" : historyPayload.meta?.type || null,
    historyLimit: config.twelveDataHistoryDays,
    price: latest.close,
    change,
    changesPercentage,
    updatedAt: latest.date,
    history
  };
}

function yahooDate(timestamp, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(timestamp * 1000));
}

async function fetchYahooMarketItem(itemConfig, saved) {
  const count = incrementalCount(saved, config.twelveDataHistoryDays);
  const now = Date.now();
  // Include weekends, holidays and a warmup buffer for long-range indicators.
  const url = new URL(`${config.yahooIndexBaseUrl}/v8/finance/chart/${encodeURIComponent(itemConfig.symbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("period1", String(Math.floor(now / 1000) - (Math.ceil(count * 1.5) + 30) * 86400));
  url.searchParams.set("period2", String(Math.floor(now / 1000) + 1));
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Yahoo market request failed (${response.status}).`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (payload?.chart?.error || result?.meta?.instrumentType !== (itemConfig.instrumentType || "INDEX") || result.meta.symbol !== itemConfig.symbol) {
    throw new Error("Yahoo returned no matching market data.");
  }
  const timeZone = result.meta.exchangeTimezoneName || "America/New_York";
  const quote = result.indicators?.quote?.[0];
  const fresh = (result.timestamp || []).map((timestamp, index) => ({
    date: yahooDate(timestamp, timeZone), open: parseNumber(quote?.open?.[index]),
    high: parseNumber(quote?.high?.[index]), low: parseNumber(quote?.low?.[index]), close: parseNumber(quote?.close?.[index])
  })).filter((row) => [row.open, row.high, row.low, row.close].every((value) => value !== null));
  if (!fresh.length) throw new Error("Yahoo returned no market candles.");
  const history = mergeHistory(saved?.history, fresh, config.twelveDataHistoryDays);
  const latest = history.at(-1);
  const timestamp = result.meta.regularMarketTime;
  const currentDate = timestamp ? yahooDate(timestamp, timeZone) : null;
  const useCurrent = currentDate && currentDate >= latest.date && parseNumber(result.meta.regularMarketPrice) !== null;
  const price = useCurrent ? parseNumber(result.meta.regularMarketPrice) : latest.close;
  const priceDate = useCurrent ? currentDate : latest.date;
  const previous = history.filter((row) => row.date < priceDate).at(-1);
  return { symbol: itemConfig.displaySymbol || itemConfig.symbol, name: itemConfig.name, market: itemConfig.market,
    provider: "Yahoo Finance", sourceSymbol: itemConfig.symbol,
    instrumentType: itemConfig.instrumentType === "FUTURE" ? "Future" : "Index",
    category: itemConfig.category || "index", unit: itemConfig.unit || null, currency: result.meta.currency || null,
    historyLimit: config.twelveDataHistoryDays, price,
    change: previous ? price - previous.close : null,
    changesPercentage: previous?.close ? (price - previous.close) / previous.close * 100 : null,
    updatedAt: useCurrent ? new Date(timestamp * 1000).toISOString() : latest.date, history };
}

// Keep historical candles, replacing overlapping dates with revised provider values.
function mergeHistory(saved = [], fresh = [], limit = 4000) {
  return [...new Map([...saved, ...fresh].map((row) => [row.date, row])).values()]
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
}

function incrementalCount(saved, limit = 4000) {
  if (!saved?.history?.length || (saved.historyLimit || 0) < limit) return limit;
  const latest = Date.parse(saved.history.at(-1).date);
  if (!Number.isFinite(latest)) return limit;
  // Calendar days deliberately overestimate trading days; overlap catches corrections.
  return Math.min(limit, Math.max(5, Math.ceil((Date.now() - latest) / 86400000) + 5));
}

function indexTasks() {
  return [{ key: "KOSPI", sourceSymbol: "KOSPI", provider: "Toss Securities", run: fetchTossKoreanIndexItem },
    ...(config.yahooIndexSeries || []).map((series) => ({
      key: series.displaySymbol || series.symbol, sourceSymbol: series.symbol, provider: "Yahoo Finance",
      run: (saved) => fetchYahooMarketItem(series, saved)
    })),
    ...(config.commoditySeries || []).map((series) => ({
      key: series.displaySymbol || series.symbol, sourceSymbol: series.symbol, provider: "Yahoo Finance", category: "commodity",
      run: (saved) => fetchYahooMarketItem({ ...series, instrumentType: "FUTURE", category: "commodity" }, saved)
    })),
    ...config.twelveDataSeries.map((series) => ({
      key: series.displaySymbol || series.symbol, sourceSymbol: series.symbol, provider: "Twelve Data",
      run: (saved) => fetchTwelveSeriesItem(series, saved)
    }))];
}

async function readSnapshots() {
  const tasks = indexTasks();
  const { rows } = await query(
    "SELECT symbol, payload, refreshed_at FROM market_index_snapshots WHERE symbol = ANY($1::text[])", [tasks.map((task) => task.key)]);
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  // A display label alone is not a data identity. Never reuse ETF candles for an index.
  return new Map(rows.filter((row) => {
    const task = byKey.get(row.symbol);
    if (!task) return false;
    if (task.key === "KOSPI" && !row.payload.sourceSymbol) return true;
    return row.payload.sourceSymbol === task.sourceSymbol && row.payload.provider === task.provider;
  }).map((row) => [row.symbol, row]));
}

function snapshotResponse(saved) {
  const items = [], skipped = [], dates = [];
  for (const task of indexTasks()) {
    const row = saved.get(task.key);
    if (row) {
      items.push({ ...row.payload, category: task.category || "index", cachedAt: new Date(row.refreshed_at).toISOString() });
      dates.push(new Date(row.refreshed_at).getTime());
    } else skipped.push({ key: task.key, reason: "Market data is temporarily unavailable." });
  }
  return { generatedAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null, items, skipped };
}

let refreshInFlight;
let nextRefreshAt = 0;
const refreshInterval = Math.max(60_000, config.marketCacheTtlMs || 900_000);

async function collectMarketIndices() {
  const saved = await readSnapshots();
  const now = Date.now();
  const tasks = indexTasks().filter((task) => {
    const row = saved.get(task.key);
    return !row || now - new Date(row.refreshed_at).getTime() >= refreshInterval;
  });
  const settled = await Promise.allSettled(tasks.map(async (task) => {
    const item = await task.run(saved.get(task.key)?.payload);
    // Timestamp the start so an older concurrent collection cannot overwrite a newer one.
    const refreshedAt = new Date(now).toISOString();
    await query(`INSERT INTO market_index_snapshots (symbol, payload, refreshed_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (symbol) DO UPDATE SET payload = EXCLUDED.payload, refreshed_at = EXCLUDED.refreshed_at
      WHERE market_index_snapshots.refreshed_at <= EXCLUDED.refreshed_at`,
    [task.key, JSON.stringify(item), refreshedAt]);
    return task.key;
  }));
  if (settled.some((result) => result.status === "rejected")) {
    console.warn("Some market index snapshots could not be refreshed; retaining saved data.");
  }
  const response = snapshotResponse(await readSnapshots());
  if (!response.items.length) throw new Error("No market index providers returned data.");
  return response;
}

function runMarketIndexCollectionCycle() {
  if (refreshInFlight) return refreshInFlight;
  if (Date.now() < nextRefreshAt) return Promise.resolve(null);
  nextRefreshAt = Date.now() + refreshInterval;
  refreshInFlight = collectMarketIndices().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

const getMarketIndices = createRefreshCache(async () => {
  const response = snapshotResponse(await readSnapshots());
  if (response.items.length) {
    // Serve persisted candles immediately, independently of upstream response times.
    if (response.skipped.length || response.items.some((item) => Date.now() - Date.parse(item.cachedAt) >= refreshInterval)) {
      runMarketIndexCollectionCycle().catch(() => console.warn("Market index background refresh failed."));
    }
    return response;
  }
  // The initial backfill is the only request that may need to wait for providers.
  await runMarketIndexCollectionCycle();
  const initial = snapshotResponse(await readSnapshots());
  if (!initial.items.length) throw new Error("Market data is temporarily unavailable.");
  return initial;
}, { ttlMs: 15_000, failureTtlMs: 15_000 });

module.exports = { getMarketIndices, runMarketIndexCollectionCycle, mergeHistory, incrementalCount };
