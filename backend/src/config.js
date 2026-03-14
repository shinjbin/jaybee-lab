const DEFAULT_FEEDS = [
  {
    key: "bbc-business",
    name: "BBC Business",
    category: "market",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml"
  },
  {
    key: "nyt-business",
    name: "New York Times Business",
    category: "market",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"
  },
  {
    key: "bbc-world",
    name: "BBC World",
    category: "current-affairs",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml"
  },
  {
    key: "nyt-world",
    name: "New York Times World",
    category: "current-affairs",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
  }
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeFeed(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const key = typeof entry.key === "string" ? entry.key.trim() : "";
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  const category =
    typeof entry.category === "string" ? entry.category.trim() : "";

  if (!key || !name || !url || !category) {
    return null;
  }

  return {
    key,
    name,
    url,
    category
  };
}

function parseFeeds(value) {
  if (!value) {
    return DEFAULT_FEEDS;
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      throw new Error("NEWS_FEEDS must be a JSON array.");
    }

    const feeds = parsed.map(normalizeFeed).filter(Boolean);

    if (feeds.length === 0) {
      throw new Error("NEWS_FEEDS did not contain any valid feed objects.");
    }

    return feeds;
  } catch (error) {
    console.warn(
      `Failed to parse NEWS_FEEDS, using defaults instead: ${error.message}`
    );
    return DEFAULT_FEEDS;
  }
}

const newsPollIntervalMs =
  parsePositiveInteger(process.env.NEWS_POLL_INTERVAL_MINUTES, 30) * 60 * 1000;

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
  newsFetchLimitPerFeed: parsePositiveInteger(
    process.env.NEWS_FETCH_LIMIT_PER_FEED,
    8
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
  newsFeeds: parseFeeds(process.env.NEWS_FEEDS),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: (
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, ""),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  openaiTimeoutMs: parsePositiveInteger(process.env.OPENAI_TIMEOUT_MS, 20000),
  aiEnabled: Boolean(process.env.OPENAI_API_KEY)
};
