const config = require("./config");
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

function findFirstArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const nested of Object.values(value)) {
    const found = findFirstArray(nested);

    if (found) {
      return found;
    }
  }

  return null;
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

async function fetchKrxJson() {
  if (!config.krxKospiUrl) {
    throw new Error("KRX_KOSPI_URL is not configured.");
  }

  if (!config.krxApiKey) {
    throw new Error("KRX_API_KEY is not configured.");
  }

  const response = await fetch(config.krxKospiUrl, {
    headers: {
      "User-Agent": config.collectorUserAgent,
      Accept: "application/json",
      [config.krxApiKeyHeader]: config.krxApiKey
    },
    signal: AbortSignal.timeout(15000)
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      cleanupText(
        payload?.msg1 ||
          payload?.message ||
          `KRX market index request failed (${response.status}).`
      )
    );
  }

  return payload;
}

function normalizeKrxHistory(payload) {
  const rows = findFirstArray(payload) || [];

  return rows
    .map((row) => ({
      date: parseDateValue(
        pickValue(row, ["BAS_DD", "TRD_DD", "date", "Date"])
      ),
      close: parseNumber(
        pickValue(row, [
          "CLSPRC_IDX",
          "TDD_CLSPRC",
          "close",
          "Close",
          "price",
          "Price",
          "IDX_CLSPRC"
        ])
      ),
      change: parseNumber(
        pickValue(row, ["CMPPREVDD_IDX", "change", "Change", "vs"])
      ),
      changesPercentage: parseNumber(
        pickValue(row, ["FLUC_RT", "change_rate", "ChangeRate", "percent_change"])
      )
    }))
    .filter((row) => row.date && row.close !== null)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-config.krxKospiHistoryDays);
}

function buildKrxKospiItem(payload) {
  const history = normalizeKrxHistory(payload);

  if (!history.length) {
    throw new Error("KRX KOSPI response did not include usable history rows.");
  }

  const latest = history[history.length - 1];
  const previous = history[history.length - 2] || null;
  const change = latest.change ?? (previous ? latest.close - previous.close : null);
  const changesPercentage =
    latest.changesPercentage ??
    (previous && previous.close
      ? ((latest.close - previous.close) / previous.close) * 100
      : null);

  return {
    symbol: "KOSPI",
    name: "KOSPI",
    market: "KR",
    provider: "KRX Open API",
    price: latest.close,
    change,
    changesPercentage,
    updatedAt: `${latest.date}T15:30:00+09:00`,
    history
  };
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
      run: async () => buildKrxKospiItem(await fetchKrxJson())
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
