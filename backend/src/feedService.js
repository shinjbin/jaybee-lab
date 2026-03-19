const { fetchArticleContent } = require("./articleContentService");
const config = require("./config");
const { cleanupText, stripHtml } = require("./utils");

const MIN_EMBEDDED_CONTENT_LENGTH = 280;
const ARTICLE_FETCH_CONCURRENCY = 3;

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

  return normalized || "gnews";
}

function buildNewsEndpoint() {
  if (!config.gnewsApiKey) {
    throw new Error("GNews API key is not configured.");
  }

  const endpoint = new URL(`${config.gnewsBaseUrl}/${config.gnewsEndpoint}`);
  endpoint.searchParams.set("lang", config.gnewsLanguage);
  endpoint.searchParams.set("max", String(config.gnewsMax));
  endpoint.searchParams.set("apikey", config.gnewsApiKey);

  if (config.gnewsEndpoint === "top-headlines") {
    endpoint.searchParams.set("topic", config.gnewsTopic);
    endpoint.searchParams.set("country", config.gnewsCountry);
  } else {
    endpoint.searchParams.set("q", config.gnewsQuery);
  }

  return endpoint;
}

function mapEntryToArticle(entry) {
  const sourceName = cleanupText(
    entry.source?.name || entry.source?.url || "GNews"
  );
  const title = cleanupText(entry.title || "");
  const url = cleanupText(entry.url || "");
  const rawDescription = entry.description || "";
  const rawContent = entry.content || rawDescription;

  return {
    sourceKey: normalizeSourceKey(`gnews-${sourceName}`),
    sourceName,
    category: config.gnewsCategory,
    title,
    url,
    description: cleanupText(stripHtml(rawDescription)),
    content: cleanupText(stripHtml(rawContent)),
    publishedAt: normalizeDate(entry.publishedAt)
  };
}

function shouldScrapeArticle(article) {
  return !article.content || article.content.length < MIN_EMBEDDED_CONTENT_LENGTH;
}

async function enrichArticleContent(article) {
  if (!shouldScrapeArticle(article)) {
    return article;
  }

  try {
    const scraped = await fetchArticleContent(article.url);

    if (!scraped?.content) {
      return article;
    }

    return {
      ...article,
      description: article.description || scraped.description || article.title,
      content: scraped.content
    };
  } catch (error) {
    console.warn(`Article scrape failed for ${article.url}: ${error.message}`);
    return article;
  }
}

async function enrichArticles(articles) {
  const results = [];

  for (let index = 0; index < articles.length; index += ARTICLE_FETCH_CONCURRENCY) {
    const batch = articles.slice(index, index + ARTICLE_FETCH_CONCURRENCY);
    const enrichedBatch = await Promise.all(batch.map(enrichArticleContent));
    results.push(...enrichedBatch);
  }

  return results;
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
      `GNews request failed (${response.status}): ${cleanupText(payload).slice(0, 240)}`
    );
  }

  const payload = await response.json();
  const entries = Array.isArray(payload.articles) ? payload.articles : [];
  const articles = entries
    .map(mapEntryToArticle)
    .filter((article) => article.title && article.url);

  return enrichArticles(articles);
}

module.exports = {
  fetchFeedArticles
};
