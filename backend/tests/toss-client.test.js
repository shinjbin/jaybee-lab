const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTossClient } = require("../src/tossClient");
const { createTokenStore } = require("../src/tossTokenStore");

const config = { tossEnabled: true, tossBaseUrl: "https://openapi.tossinvest.com",
  tossClientId: "test-client", tossClientSecret: "test-secret", tossRequestTimeoutMs: 1000,
  tossRequestIntervalMs: 0, tossIndexHistoryDays: 2 };
const response = (payload, status = 200) => ({ status, ok: status < 400, json: async () => payload });

test("Toss OAuth uses form encoding and market requests use Bearer authentication", async () => {
  let issued;
  const requests = [];
  const client = createTossClient({ config,
    tokenStore: async (issue) => (issued ||= await issue()).access_token,
    fetch: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return url.endsWith("/oauth2/token")
        ? response({ access_token: "token", expires_in: 86400 })
        : response({ result: [{ symbol: "005930", lastPrice: "72000" }] });
    } });
  assert.equal((await client.fetchCurrentPrice("005930")).lastPrice, "72000");
  assert.equal(requests[0].options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(new URLSearchParams(requests[0].options.body).get("client_id"), "test-client");
  assert.equal(requests[1].url.pathname, "/api/v1/prices");
  assert.equal(requests[1].url.searchParams.get("symbols"), "005930");
  assert.equal(requests[1].options.headers.Authorization, "Bearer token");
  assert.equal(requests[1].options.headers.appkey, undefined);
});

test("401 refreshes the rejected token once; 429 fails explicitly", async () => {
  const rejected = [];
  let calls = 0;
  const client = createTossClient({ config,
    tokenStore: async (_issue, old) => { rejected.push(old); return old ? "new" : "old"; },
    fetch: async () => ++calls === 1 ? response({}, 401) : response({ result: [] }) });
  assert.equal(await client.fetchCurrentPrice("005930"), null);
  assert.deepEqual(rejected, [null, "old"]);
  const limited = createTossClient({ config, tokenStore: async () => "token",
    fetch: async () => response({ error: { code: "rate-limit-exceeded" } }, 429) });
  await assert.rejects(limited.fetchCurrentPrice("005930"), /429.*rate-limit-exceeded/);
});

test("stock flow records preserve signed volumes and actual trading dates", async () => {
  const row = { date: "2026-09-11", foreigner: { netBuyVolume: "-319700" }, institution: { netBuyVolume: "0" } };
  const client = createTossClient({ config, tokenStore: async () => "token", fetch: async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/v1/stocks/005930/investor-trading");
    assert.equal(parsed.searchParams.get("until"), "2026-09-14");
    return response({ result: { records: [row], nextUntil: null } });
  } });
  assert.deepEqual(await client.fetchInvestorTradeByStockDaily("005930", "2026-09-14"), [row]);
});

test("historical prices request unadjusted same-date candles; no stale-date fallback", async () => {
  const client = createTossClient({ config, tokenStore: async () => "token", fetch: async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("before"), "2026-09-14T23:59:59+09:00");
    assert.equal(params.get("adjusted"), "false");
    return response({ result: { candles: [{ timestamp: "2026-09-11T00:00:00+09:00", closePrice: "70000" }] } });
  } });
  assert.equal(await client.fetchStockClosingPrice("005930", "2026-09-14"), null);
});

test("index candles paginate using nextBefore and deduplicate inclusive boundaries", async () => {
  let calls = 0;
  const candle = (day) => ({ timestamp: `2026-09-${day}T09:00:00+09:00`, closePrice: "2800" });
  const client = createTossClient({ config, tokenStore: async () => "token", fetch: async (url) => {
    if (++calls === 1) return response({ result: { candles: [candle(14), candle(11)], nextBefore: "2026-09-11T09:00:00+09:00" } });
    assert.equal(new URL(url).searchParams.get("before"), "2026-09-11T09:00:00+09:00");
    return response({ result: { candles: [candle(11), candle(10)], nextBefore: null } });
  } });
  assert.equal((await client.fetchIndexDailyChartPrice()).length, 3);
});

test("missing credentials and malformed responses fail without fabricated data", async () => {
  const disabled = createTossClient({ config: { ...config, tossEnabled: false }, fetch: () => assert.fail("must not fetch") });
  await assert.rejects(disabled.getAccessToken(), /TOSS_CLIENT_ID/);
  const malformed = createTossClient({ config, tokenStore: async () => "token", fetch: async () => response({}) });
  await assert.rejects(malformed.fetchIndexPrice(), /missing result/);
});

test("DB token cache reuses valid token, refreshes rejected token and rolls back issuance failures", async () => {
  let row = { access_token: "shared", expires_at: new Date(Date.now() + 120000) };
  const statements = [];
  let releases = 0;
  const pool = { connect: async () => ({ release: () => releases++, query: async (sql, args) => {
    statements.push(sql);
    if (sql.startsWith("SELECT access_token")) return { rows: row ? [row] : [] };
    if (sql.startsWith("INSERT")) row = { access_token: args[1], expires_at: args[2] };
    return { rows: [] };
  } }) };
  const store = createTokenStore(pool, "test-key");
  assert.equal(await store(() => assert.fail("valid shared token must be reused")), "shared");
  assert.equal(await store(async () => ({ access_token: "renewed", expires_in: 3600 }), "shared"), "renewed");
  assert.equal(await store(() => assert.fail("another process already refreshed"), "shared"), "renewed");
  row = null;
  await assert.rejects(store(async () => { throw new Error("issuance failed"); }), /issuance failed/);
  assert.ok(statements.includes("SELECT pg_advisory_xact_lock(hashtext($1))"));
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(releases, 4);
});
