function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function resolveKisBaseUrl(env, explicitBaseUrl) {
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, "");
  }

  return env === "demo"
    ? "https://openapivts.koreainvestment.com:29443"
    : "https://openapi.koreainvestment.com:9443";
}

function parseJsonArray(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function normalizeBaseUrl(value, fallback) {
  return (value || fallback).replace(/\/$/, "");
}

const newsPollIntervalMs =
  parsePositiveInteger(process.env.NEWS_POLL_INTERVAL_MINUTES, 120) * 60 * 1000;
const kisEnvironment = process.env.KIS_ENV === "demo" ? "demo" : "real";
const gnewsBaseUrl = normalizeBaseUrl(
  process.env.GNEWS_BASE_URL,
  "https://gnews.io/api/v4"
);
const defaultTwelveDataSeries = [
  { symbol: "QQQ", displaySymbol: "NASDAQ", name: "Nasdaq 100", market: "US" },
  { symbol: "DIA", displaySymbol: "DOW", name: "Dow Jones", market: "US" },
  { symbol: "SPY", displaySymbol: "S&P 500", name: "S&P 500", market: "US" },
  { symbol: "USD/KRW", displaySymbol: "USD/KRW", name: "USD to KRW", market: "FX" }
];

module.exports = {
  port: parsePositiveInteger(process.env.PORT, 3000),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://news_user:news_password@postgres:5432/news_digest",
  databaseInitRetries: parsePositiveInteger(
    process.env.DATABASE_INIT_RETRIES,
    20
  ),
  databaseRetryDelayMs: parsePositiveInteger(
    process.env.DATABASE_RETRY_DELAY_MS,
    3000
  ),
  newsSummaryBatchSize: parsePositiveInteger(
    process.env.NEWS_SUMMARY_BATCH_SIZE,
    10
  ),
  newsPollIntervalMs,
  briefingWindowHours: parsePositiveInteger(
    process.env.BRIEFING_WINDOW_HOURS,
    48
  ),
  collectorUserAgent:
    process.env.NEWS_COLLECTOR_USER_AGENT ||
    "JaybeeLabNewsBot/1.0 (+https://example.com)",
  gnewsApiKey: process.env.GNEWS_API_KEY || "",
  gnewsBaseUrl,
  gnewsEndpoint:
    process.env.GNEWS_ENDPOINT === "top-headlines" ? "top-headlines" : "search",
  gnewsQuery:
    process.env.GNEWS_QUERY ||
    'stock market OR finance OR investing OR earnings OR inflation OR federal reserve',
  gnewsTopic: process.env.GNEWS_TOPIC || "business",
  gnewsLanguage: process.env.GNEWS_LANGUAGE || "en",
  gnewsCountry: process.env.GNEWS_COUNTRY || "us",
  gnewsMax: parsePositiveInteger(process.env.GNEWS_MAX, 10),
  gnewsCategory: process.env.GNEWS_CATEGORY || "market",
  twelveDataApiKey: process.env.TWELVE_DATA_API_KEY || "",
  twelveDataBaseUrl: normalizeBaseUrl(
    process.env.TWELVE_DATA_BASE_URL,
    "https://api.twelvedata.com"
  ),
  twelveDataHistoryDays: parsePositiveInteger(
    process.env.TWELVE_DATA_HISTORY_DAYS,
    30
  ),
  twelveDataSeries: parseJsonArray(
    process.env.TWELVE_DATA_SERIES,
    defaultTwelveDataSeries
  ),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: (
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, ""),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  openaiTimeoutMs: parsePositiveInteger(process.env.OPENAI_TIMEOUT_MS, 20000),
  aiEnabled: Boolean(process.env.OPENAI_API_KEY),
  kisEnabled:
    Boolean(process.env.KIS_APP_KEY) && Boolean(process.env.KIS_APP_SECRET),
  kisAppKey: process.env.KIS_APP_KEY || "",
  kisAppSecret: process.env.KIS_APP_SECRET || "",
  kisEnvironment,
  kisBaseUrl: resolveKisBaseUrl(kisEnvironment, process.env.KIS_BASE_URL || ""),
  kisMarketFlowEnabled: parseBoolean(process.env.KIS_MARKET_FLOW_ENABLED, true),
  kisMarketCode: process.env.KIS_MARKET_CODE || "0001",
  kisFlowScreenCode: process.env.KIS_FLOW_SCREEN_CODE || "16449",
  kisMarketDivisionCode: process.env.KIS_MARKET_DIVISION_CODE || "V",
  kisFlowTopCount: parsePositiveInteger(process.env.KIS_FLOW_TOP_COUNT, 10),
  kisFlowUniverseCount: parsePositiveInteger(process.env.KIS_FLOW_UNIVERSE_COUNT, 200),
  kisFlowWeeklyWindowDays: parsePositiveInteger(process.env.KIS_FLOW_WEEKLY_WINDOW_DAYS, 7),
  kisFlowCollectionStartHour: parsePositiveInteger(process.env.KIS_FLOW_COLLECTION_START_HOUR, 8),
  kisFlowCollectionEndHour: parsePositiveInteger(process.env.KIS_FLOW_COLLECTION_END_HOUR, 16),
  kisIndexMarketDivisionCode: process.env.KIS_INDEX_MARKET_DIVISION_CODE || "U",
  kisIndexCode: process.env.KIS_INDEX_CODE || "0001",
  kisIndexPeriodCode: process.env.KIS_INDEX_PERIOD_CODE || "D",
  kisIndexHistoryDays: parsePositiveInteger(
    process.env.KIS_INDEX_HISTORY_DAYS,
    parsePositiveInteger(process.env.KRX_KOSPI_HISTORY_DAYS, 30)
  ),
  kisRequestTimeoutMs: parsePositiveInteger(
    process.env.KIS_REQUEST_TIMEOUT_MS,
    15000
  )
};
