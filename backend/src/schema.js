module.exports = `
  CREATE TABLE IF NOT EXISTS news_articles (
    id BIGSERIAL PRIMARY KEY,
    source_key TEXT NOT NULL,
    source_name TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    checksum TEXT NOT NULL UNIQUE,
    published_at TIMESTAMPTZ,
    summary TEXT,
    summary_bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
    keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    market_impact TEXT,
    sentiment TEXT,
    summary_model TEXT,
    summary_status TEXT NOT NULL DEFAULT 'pending',
    summary_error TEXT,
    summarized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS news_articles_published_idx
    ON news_articles (published_at DESC);

  CREATE INDEX IF NOT EXISTS news_articles_category_idx
    ON news_articles (category, published_at DESC);

  CREATE INDEX IF NOT EXISTS news_articles_status_idx
    ON news_articles (summary_status, published_at DESC);

  CREATE TABLE IF NOT EXISTS collector_runs (
    id BIGSERIAL PRIMARY KEY,
    trigger_source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    articles_seen INTEGER NOT NULL DEFAULT 0,
    articles_inserted INTEGER NOT NULL DEFAULT 0,
    articles_updated INTEGER NOT NULL DEFAULT 0,
    articles_summarized INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  );
`;
