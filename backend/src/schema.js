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
    translated_title TEXT,
    translated_content TEXT,
    translated_summary TEXT,
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

  ALTER TABLE news_articles
    ADD COLUMN IF NOT EXISTS translated_title TEXT;

  ALTER TABLE news_articles
    ADD COLUMN IF NOT EXISTS translated_content TEXT;

  ALTER TABLE news_articles
    ADD COLUMN IF NOT EXISTS translated_summary TEXT;

  UPDATE news_articles
  SET translated_content = COALESCE(NULLIF(translated_content, ''), translated_summary)
  WHERE translated_summary IS NOT NULL
    AND COALESCE(translated_content, '') = '';

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

  CREATE TABLE IF NOT EXISTS investor_flow_snapshots (
    id BIGSERIAL PRIMARY KEY,
    trade_date DATE NOT NULL,
    market TEXT NOT NULL,
    investor_type TEXT NOT NULL,
    rank INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    net_buy_amount NUMERIC(20, 0),
    net_buy_quantity NUMERIC(20, 0),
    close_price NUMERIC(20, 0),
    amount_source TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trade_date, market, investor_type, stock_code)
  );

  ALTER TABLE investor_flow_snapshots
    ADD COLUMN IF NOT EXISTS net_buy_quantity NUMERIC(20, 0);

  ALTER TABLE investor_flow_snapshots
    ADD COLUMN IF NOT EXISTS close_price NUMERIC(20, 0);

  ALTER TABLE investor_flow_snapshots
    ADD COLUMN IF NOT EXISTS amount_source TEXT;

  CREATE INDEX IF NOT EXISTS investor_flow_trade_date_idx
    ON investor_flow_snapshots (trade_date DESC, market, investor_type, rank);
`;
