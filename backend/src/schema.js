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

  CREATE TABLE IF NOT EXISTS investor_flow_universe (
    id BIGSERIAL PRIMARY KEY,
    as_of_date DATE NOT NULL,
    market TEXT NOT NULL,
    market_cap_rank INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    market_cap NUMERIC(20, 0) NOT NULL,
    close_price NUMERIC(20, 0),
    shares_outstanding NUMERIC(20, 0),
    source TEXT NOT NULL DEFAULT 'krx_data_api',
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (as_of_date, market, stock_code)
  );

  CREATE INDEX IF NOT EXISTS investor_flow_universe_date_idx
    ON investor_flow_universe (as_of_date DESC, market, market_cap_rank);

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_market_analysis' AND column_name = 'model'
    ) THEN
      DROP TABLE ai_market_analysis;
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS ai_market_analysis (
    id BIGSERIAL PRIMARY KEY,
    analysis_date DATE NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS ai_market_analysis_date_idx
    ON ai_market_analysis (analysis_date DESC);

  CREATE TABLE IF NOT EXISTS brokerage_reports (
    id BIGSERIAL PRIMARY KEY,
    report_date DATE NOT NULL,
    brokerage TEXT NOT NULL,
    analyst TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    stock_code TEXT NOT NULL DEFAULT '',
    stock_name TEXT NOT NULL DEFAULT '',
    sector TEXT NOT NULL DEFAULT '',
    rating TEXT NOT NULL DEFAULT '',
    target_price NUMERIC(20, 2),
    current_price NUMERIC(20, 2),
    summary TEXT NOT NULL DEFAULT '',
    report_url TEXT NOT NULL DEFAULT '',
    source_key TEXT NOT NULL DEFAULT '',
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS brokerage_reports_source_key_unique_idx
    ON brokerage_reports (source_key)
    WHERE source_key <> '';

  CREATE INDEX IF NOT EXISTS brokerage_reports_date_idx
    ON brokerage_reports (report_date DESC, created_at DESC);

  CREATE INDEX IF NOT EXISTS brokerage_reports_report_date_idx
    ON brokerage_reports (report_date);

  CREATE INDEX IF NOT EXISTS brokerage_reports_stock_idx
    ON brokerage_reports (stock_code, report_date DESC)
    WHERE stock_code <> '';

  CREATE INDEX IF NOT EXISTS brokerage_reports_brokerage_idx
    ON brokerage_reports (brokerage, report_date DESC);

`;
