const config = require("./config");
const { cleanupText, stripHtml } = require("./utils");

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeSourceKey(value) {
  const normalized = cleanupText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "fmp-news";
}

function buildNewsEndpoint() {
  const endpoint = new URL(`${config.fmpBaseUrl}${config.fmpNewsPath}`);
  endpoint.searchParams.set("limit", String(config.fmpNewsLimit));

  if (config.fmpApiKey) {
    endpoint.searchParams.set("apikey", config.fmpApiKey);
  }

  return endpoint;
}

function mapEntryToArticle(entry) {
  const sourceName = cleanupText(
    entry.site || entry.publisher || "Financial Modeling Prep"
  );
  const title = cleanupText(entry.title || entry.headline || "");
  const url = cleanupText(entry.url || entry.link || "");
  const rawDescription = entry.text || entry.snippet || entry.summary || "";
  const rawContent = entry.text || entry.content || rawDescription;

  return {
    sourceKey: normalizeSourceKey(`fmp-${sourceName}`),
    sourceName,
    category: config.fmpNewsCategory,
    title,
    url,
    description: cleanupText(stripHtml(rawDescription)),
    content: cleanupText(stripHtml(rawContent)),
    publishedAt: normalizeDate(
      entry.publishedDate || entry.publishedAt || entry.date || entry.timestamp
    )
  };
}

async function fetchFeedArticles() {
  const endpoint = buildNewsEndpoint();
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": config.collectorUserAgent,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(
      `FMP news request failed (${response.status}): ${cleanupText(payload).slice(0, 240)}`
    );
  }

  const payload = await response.json();
  const entries = Array.isArray(payload) ? payload : [];

  return entries
    .slice(0, config.fmpNewsLimit)
    .map(mapEntryToArticle)
    .filter((article) => article.title && article.url);
}

module.exports = {
  fetchFeedArticles
};
