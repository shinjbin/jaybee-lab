const { fetchArticleContent } = require("./articleContentService");
const config = require("./config");
const { cleanupText, stripHtml } = require("./utils");

const MIN_EMBEDDED_CONTENT_LENGTH = 280;
const ARTICLE_FETCH_CONCURRENCY = 3;
const YAHOO_NOISE_PATTERNS = [
  "market size",
  "cagr",
  "expected to reach",
  "forecasted to reach",
  "projected to reach",
  "growing demand",
  "industry report",
  "research report",
  "allied market research",
  "grand view research",
  "market.us",
  "globenewswire",
  "pr newswire"
];

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

  return normalized || "news-feed";
}

function buildGnewsEndpoint() {
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

function buildYahooFinanceSearchEndpoint(term) {
  const endpoint = new URL("/v1/finance/search", config.yahooFinanceBaseUrl);
  endpoint.searchParams.set("q", term);
  endpoint.searchParams.set("quotesCount", "0");
  endpoint.searchParams.set("newsCount", String(config.yahooFinanceNewsCount));
  endpoint.searchParams.set("enableFuzzyQuery", "false");
  endpoint.searchParams.set("quotesQueryId", "tss_match_phrase_query");
  endpoint.searchParams.set("newsQueryId", "news_cie_vespa");
  endpoint.searchParams.set("enableCb", "true");
  endpoint.searchParams.set("enableNavLinks", "false");
  endpoint.searchParams.set("enableEnhancedTrivialQuery", "true");
  endpoint.searchParams.set("lang", "en-US");
  endpoint.searchParams.set("region", "US");

  return endpoint;
}

function mapGnewsEntryToArticle(entry) {
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

function mapYahooNewsEntryToArticle(entry, searchTerm) {
  const sourceName = cleanupText(
    entry.publisher || entry.providerDisplayName || entry.source || "Yahoo Finance"
  );
  const title = cleanupText(entry.title || "");
  const url = cleanupText(entry.link || entry.url || "");
  const rawDescription = entry.summary || entry.description || entry.snippet || "";
  const publishedAtRaw =
    entry.pubDate || entry.publishedAt || entry.providerPublishTime * 1000;

  return {
    sourceKey: normalizeSourceKey(`yahoo-finance-${sourceName}`),
    sourceName,
    category: config.yahooFinanceCategory,
    title,
    url,
    description: cleanupText(stripHtml(rawDescription)),
    content: cleanupText(stripHtml(rawDescription)),
    publishedAt: normalizeDate(publishedAtRaw),
    rawMeta: {
      searchTerm: cleanupText(searchTerm),
      financeName: cleanupText(entry.financeName || ""),
      symbols: Array.isArray(entry.relatedTickers) ? entry.relatedTickers : []
    }
  };
}

function shouldKeepYahooArticle(article) {
  const haystack = [
    article.sourceName,
    article.title,
    article.description,
    article.url
  ]
    .map((value) => cleanupText(value).toLowerCase())
    .join(" ");

  return !YAHOO_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern));
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

function dedupeArticles(articles) {
  const deduped = new Map();

  for (const article of articles) {
    const key = cleanupText(article.url || article.title).toLowerCase();

    if (!key) {
      continue;
    }

    if (!deduped.has(key)) {
      deduped.set(key, article);
      continue;
    }

    const existing = deduped.get(key);
    const existingContentLength = existing.content?.length || 0;
    const nextContentLength = article.content?.length || 0;

    if (nextContentLength > existingContentLength) {
      deduped.set(key, article);
    }
  }

  return [...deduped.values()];
}

async function fetchJson(endpoint, providerName) {
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
      `${providerName} request failed (${response.status}): ${cleanupText(payload).slice(0, 240)}`
    );
  }

  return response.json();
}

async function fetchGnewsArticles() {
  const payload = await fetchJson(buildGnewsEndpoint(), "GNews");
  const entries = Array.isArray(payload.articles) ? payload.articles : [];

  return entries
    .map(mapGnewsEntryToArticle)
    .filter((article) => article.title && article.url);
}

async function fetchYahooFinanceArticles() {
  const collected = [];

  for (const searchTerm of config.yahooFinanceSearchTerms) {
    const payload = await fetchJson(
      buildYahooFinanceSearchEndpoint(searchTerm),
      "Yahoo Finance"
    );
    const entries = Array.isArray(payload.news) ? payload.news : [];

    for (const entry of entries) {
      collected.push(mapYahooNewsEntryToArticle(entry, searchTerm));
    }
  }

  return dedupeArticles(
    collected.filter(
      (article) => article.title && article.url && shouldKeepYahooArticle(article)
    )
  );
}

async function fetchProviderArticles(provider) {
  if (provider === "yahoo-finance") {
    return fetchYahooFinanceArticles();
  }

  return fetchGnewsArticles();
}

async function fetchFeedArticles() {
  const results = await Promise.allSettled(
    config.newsProviders.map(async (provider) => ({
      provider,
      articles: await fetchProviderArticles(provider)
    }))
  );

  const articles = [];
  const errors = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      articles.push(...result.value.articles);
      continue;
    }

    errors.push(result.reason);
  }

  if (articles.length === 0 && errors.length > 0) {
    throw errors[0];
  }

  return enrichArticles(dedupeArticles(articles));
}

module.exports = {
  buildYahooFinanceSearchEndpoint,
  dedupeArticles,
  fetchFeedArticles,
  fetchProviderArticles,
  mapYahooNewsEntryToArticle,
  normalizeDate,
  normalizeSourceKey,
  shouldKeepYahooArticle
};
