const crypto = require("crypto");

const config = require("./config");
const { parseDateInput } = require("./dateUtils");
const { query } = require("./db");
const { fetchFeedArticles } = require("./feedService");
const { summarizeArticle } = require("./summarizer");
const { cleanupText, truncateText } = require("./utils");

const CATEGORY_LABELS = {
  market: "Market",
  "current-affairs": "Current Affairs"
};

function normalizeSourceKey(value) {
  const normalized = cleanupText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "manual";
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function buildChecksum(article) {
  const publishedKey = article.publishedAt
    ? article.publishedAt.slice(0, 10)
    : "unknown";

  return crypto
    .createHash("sha256")
    .update(
      [
        article.sourceKey,
        cleanupText(article.title.toLowerCase()),
        publishedKey,
        article.url
      ].join("|")
    )
    .digest("hex");
}

function mapArticleRow(row) {
  return {
    id: row.id,
    sourceKey: row.source_key,
    sourceName: row.source_name,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || row.category,
    title: row.title,
    translatedTitle: row.translated_title,
    url: row.url,
    description: row.description,
    content: row.content,
    publishedAt: row.published_at,
    summary: row.summary,
    translatedContent: row.translated_content || row.translated_summary,
    summaryBullets: row.summary_bullets || [],
    keywords: row.keywords || [],
    marketImpact: row.market_impact,
    sentiment: row.sentiment,
    summaryStatus: row.summary_status,
    summaryModel: row.summary_model,
    summarizedAt: row.summarized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function prepareArticleForStorage(article, summary) {
  return {
    ...article,
    summary: truncateText(summary.summary, 1200),
    translatedTitle: truncateText(summary.translatedTitle, 600),
    translatedContent: truncateText(summary.translatedContent, 5000),
    summaryBullets: (summary.bullets || []).slice(0, 5),
    keywords: (summary.keywords || []).slice(0, 10),
    marketImpact: summary.marketImpact,
    sentiment: summary.sentiment,
    summaryModel: summary.model,
    summaryStatus: "completed"
  };
}

function validateManualUrl(value) {
  try {
    return new URL(cleanupText(value || "")).toString();
  } catch (_error) {
    return null;
  }
}

function validateManualSentiment(value) {
  return value === "positive" || value === "neutral" || value === "negative";
}

function validateManualImpact(value) {
  return value === "high" || value === "medium" || value === "low";
}

function normalizeStringArray(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanupText(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildManualSummary(article, input) {
  const providedSummary = cleanupText(input.summary || "");
  const providedTranslatedTitle = cleanupText(input.translatedTitle || "");
  const providedTranslatedContent = cleanupText(
    input.translatedContent || input.translatedSummary || ""
  );
  const providedBullets = normalizeStringArray(input.summaryBullets || input.bullets, 5);
  const providedKeywords = normalizeStringArray(input.keywords, 10);
  const providedImpact = cleanupText(input.marketImpact || "");
  const providedSentiment = cleanupText(input.sentiment || "");

  if (
    !providedSummary &&
    !providedTranslatedTitle &&
    !providedTranslatedContent &&
    providedBullets.length === 0 &&
    providedKeywords.length === 0 &&
    !providedImpact &&
    !providedSentiment
  ) {
    return null;
  }

  return {
    summary:
      providedSummary ||
      cleanupText(article.description || article.content || article.title),
    translatedTitle: providedTranslatedTitle || cleanupText(article.title),
    translatedContent:
      providedTranslatedContent ||
      cleanupText(article.content || article.description || article.title),
    bullets:
      providedBullets.length > 0
        ? providedBullets
        : [providedSummary || cleanupText(article.title)],
    keywords: providedKeywords,
    marketImpact: validateManualImpact(providedImpact)
      ? providedImpact
      : "medium",
    sentiment: validateManualSentiment(providedSentiment)
      ? providedSentiment
      : "neutral",
    model: "manual-input"
  };
}

function normalizeManualArticleInput(input = {}) {
  const sourceName = cleanupText(input.sourceName || "");
  const title = cleanupText(input.title || "");
  const url = cleanupText(input.url || "");

  if (!sourceName) {
    const error = new Error("sourceName is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!title) {
    const error = new Error("title is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!url) {
    const error = new Error("url is required.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedUrl = validateManualUrl(url);

  if (!normalizedUrl) {
    const error = new Error("url must be an absolute http(s) URL.");
    error.statusCode = 400;
    throw error;
  }

  const publishedAt = normalizeTimestamp(input.publishedAt);

  if (input.publishedAt && !publishedAt) {
    const error = new Error("publishedAt must be a valid date or ISO timestamp.");
    error.statusCode = 400;
    throw error;
  }

  return {
    sourceKey: normalizeSourceKey(input.sourceKey || `manual-${sourceName}`),
    sourceName,
    category: cleanupText(input.category || "") || "market",
    title,
    url: normalizedUrl,
    description: cleanupText(input.description || ""),
    content: cleanupText(input.content || input.description || ""),
    publishedAt
  };
}

async function resolveLatestNewsDate(preferredDate) {
  const requestedDate = parseDateInput(preferredDate);

  if (requestedDate) {
    return requestedDate;
  }

  const result = await query(
    `
      SELECT MAX((COALESCE(published_at, created_at) AT TIME ZONE 'Asia/Seoul')::date)::text AS latest_date
      FROM news_articles
    `
  );

  return result.rows[0]?.latest_date || null;
}

async function createCollectorRun(trigger) {
  const result = await query(
    `
      INSERT INTO collector_runs (trigger_source)
      VALUES ($1)
      RETURNING id, started_at
    `,
    [trigger]
  );

  return result.rows[0];
}

async function finishCollectorRun(runId, status, payload) {
  await query(
    `
      UPDATE collector_runs
      SET
        finished_at = NOW(),
        status = $2,
        articles_seen = $3,
        articles_inserted = $4,
        articles_updated = $5,
        articles_summarized = $6,
        error_message = $7
      WHERE id = $1
    `,
    [
      runId,
      status,
      payload.articlesSeen,
      payload.articlesInserted,
      payload.articlesUpdated,
      payload.articlesSummarized,
      payload.errorMessage || null
    ]
  );
}

async function upsertArticle(article) {
  const checksum = buildChecksum(article);

  const result = await query(
    `
      INSERT INTO news_articles (
        source_key,
        source_name,
        category,
        title,
        url,
        description,
        content,
        checksum,
        published_at,
        summary,
        translated_title,
        translated_content,
        translated_summary,
        summary_bullets,
        keywords,
        market_impact,
        sentiment,
        summary_model,
        summary_status,
        summary_error,
        summarized_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18, NULL, NOW()
      )
      ON CONFLICT (checksum) DO UPDATE
      SET
        source_name = EXCLUDED.source_name,
        category = EXCLUDED.category,
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        description = CASE
          WHEN news_articles.description = '' THEN EXCLUDED.description
          ELSE news_articles.description
        END,
        content = CASE
          WHEN news_articles.content = '' THEN EXCLUDED.content
          ELSE news_articles.content
        END,
        published_at = COALESCE(EXCLUDED.published_at, news_articles.published_at),
        summary = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR news_articles.summary IS NULL
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.summary
          ELSE news_articles.summary
        END,
        translated_title = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR news_articles.translated_title IS NULL
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.translated_title
          ELSE news_articles.translated_title
        END,
        translated_content = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR COALESCE(news_articles.translated_content, news_articles.translated_summary) IS NULL
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.translated_content
          ELSE news_articles.translated_content
        END,
        translated_summary = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR COALESCE(news_articles.translated_content, news_articles.translated_summary) IS NULL
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.translated_summary
          ELSE news_articles.translated_summary
        END,
        summary_bullets = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR jsonb_array_length(news_articles.summary_bullets) = 0
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.summary_bullets
          ELSE news_articles.summary_bullets
        END,
        keywords = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR jsonb_array_length(news_articles.keywords) = 0
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.keywords
          ELSE news_articles.keywords
        END,
        market_impact = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR news_articles.market_impact IS NULL
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.market_impact
          ELSE news_articles.market_impact
        END,
        sentiment = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR news_articles.sentiment NOT IN ('positive', 'neutral', 'negative')
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.sentiment
          ELSE news_articles.sentiment
        END,
        summary_model = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR news_articles.summary_model IS NULL
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.summary_model
          ELSE news_articles.summary_model
        END,
        summary_status = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR news_articles.translated_title IS NULL
            OR COALESCE(news_articles.translated_content, news_articles.translated_summary) IS NULL
            OR news_articles.sentiment NOT IN ('positive', 'neutral', 'negative')
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN EXCLUDED.summary_status
          ELSE news_articles.summary_status
        END,
        summary_error = NULL,
        summarized_at = CASE
          WHEN news_articles.summary_status <> 'completed'
            OR news_articles.summarized_at IS NULL
            OR (news_articles.summary_model = 'fallback-rules' AND EXCLUDED.summary_model <> 'fallback-rules')
            THEN NOW()
          ELSE news_articles.summarized_at
        END,
        updated_at = NOW()
      RETURNING id, summary_status, (xmax = 0) AS inserted
    `,
    [
      article.sourceKey,
      article.sourceName,
      article.category,
      article.title,
      article.url,
      truncateText(article.description, 2800),
      truncateText(article.content, 6000),
      checksum,
      article.publishedAt,
      article.summary,
      article.translatedTitle,
      article.translatedContent,
      JSON.stringify(article.summaryBullets || []),
      JSON.stringify(article.keywords || []),
      article.marketImpact,
      article.sentiment,
      article.summaryModel,
      article.summaryStatus
    ]
  );

  return result.rows[0];
}

async function createManualArticle(input = {}) {
  const article = normalizeManualArticleInput(input);
  const summary = buildManualSummary(article, input) || (await summarizeArticle(article));
  const preparedArticle = prepareArticleForStorage(article, summary);
  const record = await upsertArticle(preparedArticle);
  const savedArticleResult = await query(
    `
      SELECT *
      FROM news_articles
      WHERE id = $1
    `,
    [record.id]
  );

  return {
    inserted: record.inserted,
    article: mapArticleRow(savedArticleResult.rows[0])
  };
}

async function createManualArticlesBulk(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("items must be a non-empty array.");
    error.statusCode = 400;
    throw error;
  }

  if (items.length > 100) {
    const error = new Error("items must contain at most 100 articles.");
    error.statusCode = 400;
    throw error;
  }

  const results = [];

  for (let index = 0; index < items.length; index += 1) {
    try {
      const saved = await createManualArticle(items[index]);
      results.push({
        index,
        success: true,
        inserted: saved.inserted,
        article: saved.article
      });
    } catch (error) {
      results.push({
        index,
        success: false,
        error: error.message
      });
    }
  }

  return {
    total: items.length,
    succeeded: results.filter((item) => item.success).length,
    failed: results.filter((item) => !item.success).length,
    items: results
  };
}

async function summarizePendingArticles() {
  const result = await query(
    `
      SELECT *
      FROM news_articles
      WHERE summary_status IN ('pending', 'failed')
         OR translated_title IS NULL
         OR COALESCE(translated_content, translated_summary) IS NULL
         OR sentiment NOT IN ('positive', 'neutral', 'negative')
      ORDER BY COALESCE(published_at, created_at) DESC
      LIMIT $1
    `,
    [config.newsSummaryBatchSize]
  );

  let summarizedCount = 0;

  for (const row of result.rows) {
    try {
      const summary = await summarizeArticle(mapArticleRow(row));
      const preparedArticle = prepareArticleForStorage(mapArticleRow(row), summary);

      await query(
        `
          UPDATE news_articles
          SET
            summary = $1,
            translated_title = $2,
            translated_content = $3,
            translated_summary = $3,
            summary_bullets = $4::jsonb,
            keywords = $5::jsonb,
            market_impact = $6,
            sentiment = $7,
            summary_model = $8,
            summary_status = 'completed',
            summary_error = NULL,
            summarized_at = NOW(),
            updated_at = NOW()
          WHERE id = $9
        `,
        [
          preparedArticle.summary,
          preparedArticle.translatedTitle,
          preparedArticle.translatedContent,
          JSON.stringify(preparedArticle.summaryBullets || []),
          JSON.stringify(preparedArticle.keywords || []),
          preparedArticle.marketImpact,
          preparedArticle.sentiment,
          preparedArticle.summaryModel,
          row.id
        ]
      );

      summarizedCount += 1;
    } catch (error) {
      await query(
        `
          UPDATE news_articles
          SET
            summary_status = 'failed',
            summary_error = $1,
            updated_at = NOW()
          WHERE id = $2
        `,
        [truncateText(error.message, 500), row.id]
      );
    }
  }

  return summarizedCount;
}

async function runCollectionCycle(trigger = "manual") {
  const run = await createCollectorRun(trigger);

  const counters = {
    articlesSeen: 0,
    articlesInserted: 0,
    articlesUpdated: 0,
    articlesSummarized: 0,
    errorMessage: null
  };

  try {
    const articles = await fetchFeedArticles();
    counters.articlesSeen += articles.length;

    for (const article of articles) {
      const summary = await summarizeArticle(article);
      const preparedArticle = prepareArticleForStorage(article, summary);
      const record = await upsertArticle(preparedArticle);
      counters.articlesSummarized += 1;

      if (record.inserted) {
        counters.articlesInserted += 1;
      } else {
        counters.articlesUpdated += 1;
      }
    }

    counters.articlesSummarized += await summarizePendingArticles();

    await finishCollectorRun(run.id, "completed", counters);
    return {
      runId: run.id,
      ...counters
    };
  } catch (error) {
    counters.errorMessage = truncateText(error.message, 500);
    await finishCollectorRun(run.id, "failed", counters);
    throw error;
  }
}

async function getLatestArticles({ limit = 10, category, date } = {}) {
  const effectiveDate = await resolveLatestNewsDate(date);

  if (!effectiveDate) {
    return {
      effectiveDate: null,
      items: []
    };
  }

  const values = [effectiveDate];
  const whereClauses = [
    `(COALESCE(published_at, created_at) AT TIME ZONE 'Asia/Seoul')::date = $1::date`
  ];

  if (category) {
    values.push(category);
    whereClauses.push(`category = $${values.length}`);
  }

  values.push(limit);

  const result = await query(
    `
      SELECT *
      FROM news_articles
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY COALESCE(published_at, created_at) DESC
      LIMIT $${values.length}
    `,
    values
  );

  return {
    effectiveDate,
    items: result.rows.map(mapArticleRow)
  };
}

async function getLatestRun() {
  const result = await query(
    `
      SELECT *
      FROM collector_runs
      ORDER BY started_at DESC
      LIMIT 1
    `
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: row.id,
    triggerSource: row.trigger_source,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    articlesSeen: row.articles_seen,
    articlesInserted: row.articles_inserted,
    articlesUpdated: row.articles_updated,
    articlesSummarized: row.articles_summarized,
    errorMessage: row.error_message
  };
}

async function getLatestBriefing({ date } = {}) {
  const effectiveDate = await resolveLatestNewsDate(date);

  if (!effectiveDate) {
    return {
      effectiveDate: null,
      generatedAt: new Date().toISOString(),
      totalArticles: 0,
      latestRun: await getLatestRun(),
      spotlight: [],
      categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
        key,
        label,
        count: 0,
        items: []
      }))
    };
  }

  const result = await query(
    `
      SELECT *
      FROM news_articles
      WHERE (COALESCE(published_at, created_at) AT TIME ZONE 'Asia/Seoul')::date = $1::date
      ORDER BY
        CASE market_impact
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          ELSE 3
        END,
        COALESCE(published_at, created_at) DESC
      LIMIT 10
    `,
    [effectiveDate]
  );

  const articles = result.rows.map(mapArticleRow);
  const categories = Object.entries(CATEGORY_LABELS).map(([key, label]) => {
    const items = articles
      .filter((article) => article.category === key)
      .slice(0, 4);

    return {
      key,
      label,
      count: items.length,
      items
    };
  });

  const spotlight = articles
    .filter((article) => article.summaryStatus === "completed")
    .slice(0, 3);

  return {
    effectiveDate,
    generatedAt: new Date().toISOString(),
    totalArticles: articles.length,
    latestRun: await getLatestRun(),
    spotlight,
    categories
  };
}

module.exports = {
  createManualArticle,
  createManualArticlesBulk,
  getLatestArticles,
  getLatestBriefing,
  getLatestRun,
  runCollectionCycle
};
