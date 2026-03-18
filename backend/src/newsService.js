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
        published_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        summary_status = CASE
          WHEN news_articles.summary_status = 'completed'
            AND news_articles.translated_title IS NOT NULL
            AND COALESCE(news_articles.translated_content, news_articles.translated_summary) IS NOT NULL
            AND news_articles.sentiment IN ('positive', 'neutral', 'negative')
            THEN news_articles.summary_status
          ELSE 'pending'
        END,
        summary_error = NULL,
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
      article.publishedAt
    ]
  );

  return result.rows[0];
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
          truncateText(summary.summary, 1200),
          truncateText(summary.translatedTitle, 600),
          truncateText(summary.translatedContent, 5000),
          JSON.stringify(summary.bullets || []),
          JSON.stringify(summary.keywords || []),
          summary.marketImpact,
          summary.sentiment,
          summary.model,
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
      const record = await upsertArticle(article);

      if (record.inserted) {
        counters.articlesInserted += 1;
      } else {
        counters.articlesUpdated += 1;
      }
    }

    counters.articlesSummarized = await summarizePendingArticles();

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

async function getLatestArticles({ limit = 12, category, date } = {}) {
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
      LIMIT 24
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
  getLatestArticles,
  getLatestBriefing,
  getLatestRun,
  runCollectionCycle
};
