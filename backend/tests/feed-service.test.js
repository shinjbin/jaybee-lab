const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const configPath = path.resolve(__dirname, "../src/config.js");
const feedServicePath = path.resolve(__dirname, "../src/feedService.js");

const {
  buildYahooFinanceSearchEndpoint,
  dedupeArticles,
  mapYahooNewsEntryToArticle,
  shouldKeepYahooArticle
} = require(feedServicePath);

describe("feedService Yahoo Finance helpers", () => {
  it("검색어 기반 Yahoo Finance 검색 endpoint를 구성해야 한다", () => {
    const endpoint = buildYahooFinanceSearchEndpoint("market");

    assert.equal(endpoint.origin, "https://query1.finance.yahoo.com");
    assert.equal(endpoint.pathname, "/v1/finance/search");
    assert.equal(endpoint.searchParams.get("q"), "market");
    assert.equal(endpoint.searchParams.get("quotesCount"), "0");
    assert.ok(Number(endpoint.searchParams.get("newsCount")) > 0);
  });

  it("Yahoo Finance news entry를 현재 article 스키마로 매핑해야 한다", () => {
    const article = mapYahooNewsEntryToArticle(
      {
        title: "Inflation cools as markets rally",
        link: "https://finance.yahoo.com/news/inflation-cools-123.html",
        publisher: "Reuters",
        summary: "Stocks rose after the latest inflation print came in softer.",
        providerPublishTime: 1714550400,
        relatedTickers: ["^GSPC", "QQQ"]
      },
      "inflation"
    );

    assert.equal(article.sourceName, "Reuters");
    assert.equal(article.category, "market");
    assert.equal(article.title, "Inflation cools as markets rally");
    assert.equal(article.url, "https://finance.yahoo.com/news/inflation-cools-123.html");
    assert.match(article.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(article.rawMeta.searchTerm, "inflation");
    assert.deepEqual(article.rawMeta.symbols, ["^GSPC", "QQQ"]);
  });

  it("Yahoo Finance 기사 중복은 URL 기준으로 제거하고 더 긴 본문을 남겨야 한다", () => {
    const deduped = dedupeArticles([
      {
        title: "Markets rally",
        url: "https://finance.yahoo.com/news/markets-rally",
        content: "short"
      },
      {
        title: "Markets rally duplicate",
        url: "https://finance.yahoo.com/news/markets-rally",
        content: "this is a much longer article body"
      },
      {
        title: "Earnings preview",
        url: "https://finance.yahoo.com/news/earnings-preview",
        content: "unique"
      }
    ]);

    assert.equal(deduped.length, 2);
    assert.equal(
      deduped.find((item) => item.url.includes("markets-rally")).content,
      "this is a much longer article body"
    );
  });

  it("홍보성 리서치 기사 패턴은 Yahoo Finance 결과에서 제외해야 한다", () => {
    assert.equal(
      shouldKeepYahooArticle({
        sourceName: "PR Newswire",
        title: "Frozen Food Market Expected to Reach $607.2 Billion by 2032 at 4.4% CAGR",
        description: "Allied Market Research released a new industry report.",
        url: "https://finance.yahoo.com/news/frozen-food-market-expected-reach"
      }),
      false
    );

    assert.equal(
      shouldKeepYahooArticle({
        sourceName: "Reuters",
        title: "Stocks gain as investors await Federal Reserve decision",
        description: "Markets rose ahead of the central bank update.",
        url: "https://finance.yahoo.com/news/stocks-gain-fed-decision"
      }),
      true
    );
  });

  it("지원하지 않는 provider 이름은 기본 GNews fetch 경로로 처리해야 한다", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.GNEWS_API_KEY;

    process.env.GNEWS_API_KEY = "test-gnews-key";
    delete require.cache[configPath];
    delete require.cache[feedServicePath];
    const { fetchProviderArticles } = require(feedServicePath);

    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          articles: [
            {
              title: "Fed signals patience",
              url: "https://example.com/fed-signals-patience",
              description: "Markets digest the latest central bank remarks.",
              source: { name: "Example News" },
              publishedAt: "2026-04-27T12:00:00Z"
            }
          ]
        };
      }
    });

    try {
      const articles = await fetchProviderArticles("unknown-provider");
      assert.equal(articles.length, 1);
      assert.equal(articles[0].sourceName, "Example News");
    } finally {
      global.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.GNEWS_API_KEY;
      } else {
        process.env.GNEWS_API_KEY = originalApiKey;
      }
      delete require.cache[configPath];
      delete require.cache[feedServicePath];
    }
  });
});
