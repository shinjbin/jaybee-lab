const config = require("./config");
const { fetchIndexDailyChartPrice, fetchIndexPrice } = require("./kisClient");
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

function getSeoulDateString(offsetDays = 0) {
  const now = new Date();
  const seoulText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const [year, month, day] = seoulText.split("-").map(Number);
  const baseDate = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return baseDate.toISOString().slice(0, 10).replace(/-/g, "");
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

function normalizeKisHistory(payload) {
  const rows = Array.isArray(payload?.output2)
    ? payload.output2
    : Array.isArray(payload?.output1)
      ? payload.output1
      : findFirstArray(payload) || [];

  return rows
    .map((row) => ({
      date: parseDateValue(
        pickValue(row, ["stck_bsop_date", "bsop_date", "date", "dt"])
      ),
      close: parseNumber(
        pickValue(row, ["bstp_nmix_prpr", "close", "clpr", "prpr"])
      )
    }))
    .filter((row) => row.date && row.close !== null)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-config.kisIndexHistoryDays);
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

async function fetchKisKoreanIndexItem() {
  if (!config.kisEnabled) {
    throw new Error("KIS_APP_KEY and KIS_APP_SECRET are required for KOSPI index collection.");
  }

  const endDate = getSeoulDateString();
  const startDate = getSeoulDateString(-config.kisIndexHistoryDays - 10);
  const [currentPayload, historyPayload] = await Promise.all([
    fetchIndexPrice(),
    fetchIndexDailyChartPrice({ startDate, endDate })
  ]);

  const currentRow = Array.isArray(currentPayload?.output)
    ? currentPayload.output[0] || null
    : currentPayload?.output || null;
  const history = normalizeKisHistory(historyPayload);

  if (!currentRow && !history.length) {
    throw new Error("KIS index response did not include usable index data.");
  }

  const latest = history[history.length - 1] || null;
  const previous = history[history.length - 2] || null;
  const price =
    parseNumber(pickValue(currentRow, ["bstp_nmix_prpr", "close", "clpr"])) ??
    latest?.close ??
    null;

  if (price === null) {
    throw new Error("KIS index response did not include a usable KOSPI price.");
  }

  const change =
    parseNumber(pickValue(currentRow, ["bstp_nmix_prdy_vrss", "vs", "change"])) ??
    (previous ? price - previous.close : null);
  const changesPercentage =
    parseNumber(pickValue(currentRow, ["bstp_nmix_prdy_ctrt", "flt_rt", "rate"])) ??
    (previous && previous.close ? ((price - previous.close) / previous.close) * 100 : null);

  return {
    symbol: "KOSPI",
    name: "KOSPI",
    market: "KR",
    provider: "Korea Investment & Securities",
    price,
    change,
    changesPercentage,
    updatedAt: latest ? `${latest.date}T15:30:00+09:00` : new Date().toISOString(),
    history: history.length
      ? history
      : [{ date: parseDateValue(endDate), close: price }]
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
      run: fetchKisKoreanIndexItem
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
