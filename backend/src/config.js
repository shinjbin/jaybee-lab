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

const newsPollIntervalMs =
  parsePositiveInteger(process.env.NEWS_POLL_INTERVAL_MINUTES, 30) * 60 * 1000;
const kisEnvironment = process.env.KIS_ENV === "demo" ? "demo" : "real";
const fmpBaseUrl = (
  process.env.FMP_BASE_URL || "https://financialmodelingprep.com/api/v3"
).replace(/\/$/, "");
const fmpNewsPath = process.env.FMP_NEWS_PATH || "/stock_news";

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
  fmpApiKey: process.env.FMP_API_KEY || "",
  fmpBaseUrl,
  fmpNewsPath: fmpNewsPath.startsWith("/") ? fmpNewsPath : `/${fmpNewsPath}`,
  fmpNewsLimit: parsePositiveInteger(process.env.FMP_NEWS_LIMIT, 12),
  fmpNewsCategory: process.env.FMP_NEWS_CATEGORY || "market",
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
  kisRequestTimeoutMs: parsePositiveInteger(
    process.env.KIS_REQUEST_TIMEOUT_MS,
    15000
  )
};
