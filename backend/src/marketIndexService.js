const config = require("./config");
const { fetchIndexDailyChartPrice, fetchIndexPrice } = require("./tossClient");
const { cleanupText } = require("./utils");

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
  return rows.map((row) => ({ date: row.timestamp?.slice(0, 10), close: parseNumber(row.closePrice) }))
    .filter((row) => row.date && row.close !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeTwelveHistory(payload) {
  const rows = Array.isArray(payload?.values) ? payload.values : [];

  return rows
    .map((row) => ({
      date: parseDateValue(row.datetime || row.date),
      close: parseNumber(row.close)
    }))
    .filter((row) => row.date && row.close !== null)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-config.twelveDataHistoryDays);
}

async function fetchTossKoreanIndexItem() {
  const [current, candles] = await Promise.all([fetchIndexPrice(), fetchIndexDailyChartPrice()]);
  const allHistory = normalizeTossHistory(candles);
  const latest = allHistory.at(-1);
  const price = parseNumber(current?.lastPrice) ?? latest?.close ?? null;
  if (price === null) throw new Error("Toss index response did not include a usable KOSPI price.");
  const priceDate = current?.timestamp?.slice(0, 10) || latest?.date;
  const previous = allHistory.filter((row) => row.date < priceDate).at(-1);
  return {
    symbol: "KOSPI", name: "KOSPI", market: "KR", provider: "Toss Securities",
    price, change: previous ? price - previous.close : null,
    changesPercentage: previous?.close ? ((price - previous.close) / previous.close) * 100 : null,
    updatedAt: current?.timestamp || candles.find((row) => row.timestamp?.startsWith(latest?.date))?.timestamp || null,
    history: allHistory.slice(-config.tossIndexHistoryDays)
  };
}

async function fetchTwelveSeriesItem(itemConfig) {
  const historyPayload = await fetchTwelveDataJson("/time_series", {
    symbol: itemConfig.symbol,
    interval: "1day",
    outputsize: config.twelveDataHistoryDays,
    order: "ASC"
  });

  const history = normalizeTwelveHistory(historyPayload);
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
    price: latest.close,
    change,
    changesPercentage,
    updatedAt: latest.date,
    history
  };
}

async function getMarketIndices() {
  const tasks = [
    {
      key: "KOSPI",
      run: fetchTossKoreanIndexItem
    },
    ...config.twelveDataSeries.map((series) => ({
      key: series.displaySymbol || series.symbol,
      run: async () => fetchTwelveSeriesItem(series)
    }))
  ];

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const items = [];
  const skipped = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(result.value);
      return;
    }

    skipped.push({
      key: tasks[index].key,
      reason: cleanupText(result.reason?.message || "Unknown error")
    });
  });

  if (!items.length) {
    throw new Error("No market index providers returned data.");
  }

  return {
    generatedAt: new Date().toISOString(),
    items,
    skipped
  };
}

module.exports = {
  getMarketIndices
};
