const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const vm = require("node:vm");
const { parseDateInput } = require("../src/dateUtils");
const { createRefreshCache } = require("../src/refreshCache");
const { createPublicHtmlFetcher, isPublicAddress } = require("../src/publicHttp");
const { createApiCapacityMiddleware, createAdminAuthMiddleware } = require("../src/security");

function load(name, overrides = {}, globals = {}) {
  const filename = path.resolve(__dirname, "../", name);
  const req = createRequire(filename);
  const context = { module: { exports: {} }, require: id => overrides[id] || req(id),
    console: { warn() {}, log() {} }, Date, Intl, URL, URLSearchParams, AbortSignal,
    setTimeout, clearTimeout, ...globals };
  vm.runInNewContext(readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}

test("calendar dates reject impossible days, year zero and non-string query input", () => {
  for (const value of ["2026-02-29", "2026-04-31", "2026-99-01", "0000-01-01", [], {}]) {
    assert.equal(parseDateInput(value), null);
  }
  assert.equal(parseDateInput("2024-02-29"), "2024-02-29");
});

test("template admin API credentials fail closed even when longer than 32 characters", () => {
  for (const key of ["REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS", "replace-with-at-least-32-random-characters"]) {
    let status;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    createAdminAuthMiddleware(key)({ get: () => key }, res, () => assert.fail("template key accepted"));
    assert.equal(status, 503);
  }
});

test("flow rejects oversized/invalid ranges before DB access and fills dates correctly", async () => {
  let queries = 0;
  const service = load("src/investorFlowService.js", {
    "./db": { query: async sql => {
      queries++;
      return { rows: sql.includes("MAX(trade_date)") ? [{ latest_date: "2026-10-12" }] : [] };
    } }, "./tossClient": {}, "./investorFlowUniverseService": {}
  });
  for (const input of [
    { startDate: "1800-01-01", endDate: "2026-10-12" },
    { startDate: "2026-02-30", endDate: "2026-10-12" },
    { startDate: "2026-10-12" }, { date: ["2026-10-12"] }
  ]) {
    await assert.rejects(service.getInvestorFlowByDate(input), error => error.statusCode === 400);
  }
  assert.equal(queries, 0);
  const result = await service.getInvestorFlowByDate({ startDate: "2026-10-11", endDate: "2026-10-12" });
  assert.deepEqual(Array.from(result.trend.foreign, row => row.date), ["2026-10-11", "2026-10-12"]);
});

test("cache merges concurrent requests, caches results, and backs off after errors", async () => {
  let time = 0, calls = 0, fail = false;
  const get = createRefreshCache(async () => {
    calls++;
    if (fail) throw new Error("upstream unavailable");
    return calls;
  }, { now: () => time, ttlMs: 100, failureTtlMs: 50 });
  assert.deepEqual(await Promise.all([get(), get(), get()]), [1, 1, 1]);
  assert.equal(await get({ force: true }), 1);
  time = 101; fail = true;
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  assert.equal(calls, 2);
  time = 152; fail = false;
  assert.equal(await get(), 3);
  const cold = createRefreshCache(async () => { calls++; throw new Error("failure"); },
    { now: () => time, failureTtlMs: 50 });
  await assert.rejects(cold()); await assert.rejects(cold());
  assert.equal(calls, 4);
});

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
function htmlResponse(chunks = [Buffer.from("<p>article</p>")], headers = {}, statusCode = 200) {
  const response = Readable.from(chunks);
  response.statusCode = statusCode;
  response.headers = { "content-type": "text/html; charset=utf-8", ...headers };
  return response;
}

test("scraper rejects private, link-local, mapped IPv6, numeric loopback and non-web URLs", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  let calls = 0;
  const fetchHtml = createPublicHtmlFetcher({ lookup: async () => [{ address: "10.0.0.1", family: 4 }],
    request: async () => { calls++; return htmlResponse(); } });
  for (const url of ["http://127.0.0.1", "http://2130706433", "http://[::1]", "http://backend",
    "http://169.254.169.254", "file:///etc/passwd", "https://example.com:8080", "https://user:pass@example.com"]) {
    await assert.rejects(fetchHtml(url));
  }
  assert.equal(calls, 0);
});

test("mixed DNS results are rejected and public connections pin validated DNS addresses", async () => {
  const mixed = createPublicHtmlFetcher({ lookup: async () => [
    { address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }
  ], request: () => assert.fail("must not connect") });
  await assert.rejects(mixed("https://example.com"));
  let lookups = 0;
  const fetchHtml = createPublicHtmlFetcher({ lookup: async () => { lookups++; return publicDns(); },
    request: async (url, options) => {
      assert.equal(url.hostname, "example.com");
      options.lookup("example.com", {}, (error, address) => {
        assert.equal(error, null); assert.equal(address, "93.184.216.34");
      });
      options.lookup("example.com", { all: true }, (error, addresses) => {
        assert.equal(error, null); assert.equal(addresses[0].address, "93.184.216.34");
      });
      return htmlResponse();
    } });
  assert.equal(await fetchHtml("https://example.com"), "<p>article</p>");
  assert.equal(lookups, 1);
});

test("every redirect is validated, redirect loops bounded and downgrade refused", async () => {
  for (const location of ["http://127.0.0.1/", "https://169.254.169.254/", "http://example.com/"]) {
    let calls = 0;
    const fetchHtml = createPublicHtmlFetcher({ lookup: publicDns,
      request: async () => { calls++; return htmlResponse([], { location }, 302); } });
    await assert.rejects(fetchHtml("https://example.com"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const loop = createPublicHtmlFetcher({ lookup: publicDns,
    request: async () => { calls++; return htmlResponse([], { location: "/again" }, 302); } });
  await assert.rejects(loop("https://example.com", { maxRedirects: 2 }), /redirect limit/);
  assert.equal(calls, 3);
});

test("chunked/declared oversized HTML and compressed responses are cancelled", async () => {
  for (const [chunks, headers] of [
    [[Buffer.alloc(6), Buffer.alloc(6)], {}],
    [[], { "content-length": "11" }],
    [[], { "content-encoding": "gzip" }]
  ]) {
    const response = htmlResponse(chunks, headers);
    const fetchHtml = createPublicHtmlFetcher({ lookup: publicDns, request: async () => response });
    await assert.rejects(fetchHtml("https://example.com", { maxBytes: 10 }), /too large|encoding/);
    assert.equal(response.destroyed, true);
  }
});

test("market cache merges queries and hides provider error messages", async () => {
  let twelveCalls = 0, tossCalls = 0;
  const service = load("src/marketIndexService.js", {
    "./tossClient": {
      fetchIndexPrice: async () => { tossCalls++; return { lastPrice: "2800", timestamp: "2026-10-12" }; },
      fetchIndexDailyChartPrice: async () => { tossCalls++; return []; }
    }
  }, { fetch: async () => { twelveCalls++; return { ok: false,
    json: async () => ({ status: "error", message: "secret-sentinel" }) }; } });
  const [first, second] = await Promise.all([service.getMarketIndices(), service.getMarketIndices()]);
  await service.getMarketIndices();
  assert.equal(first, second);
  assert.equal(twelveCalls, 4); assert.equal(tossCalls, 2);
  assert.ok(!JSON.stringify(first).includes("secret-sentinel"));
});

test("collector diagnostics are sanitized before public responses", async () => {
  const service = load("src/newsService.js", {
    "./db": { query: async () => ({ rows: [{ error_message: "provider secret-sentinel" }] }) }
  });
  assert.ok(!JSON.stringify(await service.getLatestRun()).includes("secret-sentinel"));
});

test("DB startup rejects admin roles, limits query time and executes no DDL", async () => {
  let options, admin = true;
  const statements = [];
  class Pool {
    constructor(settings) { options = settings; }
    async query(sql) {
      statements.push(sql);
      return { rows: sql.includes("pg_roles") ? [{ rolsuper: admin, rolcreatedb: false,
        rolcreaterole: false, rolreplication: false, rolbypassrls: false }] : [] };
    }
  }
  const db = load("src/db.js", { pg: { Pool } });
  await assert.rejects(db.initializeDatabase(), /administrative/);
  admin = false;
  await db.initializeDatabase();
  assert.equal(options.statement_timeout, 15_000);
  assert.equal(options.connectionTimeoutMillis, 5_000);
  assert.ok(statements.every(sql => !/CREATE|ALTER|DROP/.test(sql)));
});

test("migration provisions a non-owner role atomically and rejects inherited roles", async () => {
  let inherited = false;
  const statements = [];
  const client = { query: async sql => {
    statements.push(sql);
    return { rows: sql.includes("SELECT 1 FROM pg_auth_members") && inherited ? [{}] : [] };
  }, release() {} };
  class Pool { async connect() { return client; } async end() {} }
  const migration = load("migrate.js", { pg: { Pool } });
  const env = { POSTGRES_USER: "news_admin", DATABASE_USER: "news_app", DATABASE_PASSWORD: "a".repeat(32) };
  await migration.migrate(env);
  assert.ok(statements.some(sql => sql.includes("NOSUPERUSER NOCREATEDB NOCREATEROLE")));
  assert.ok(statements.some(sql => sql.includes("GRANT SELECT, INSERT, UPDATE, DELETE")));
  assert.equal(statements.at(-1), "COMMIT");
  inherited = true;
  await assert.rejects(migration.migrate(env), /inherit/);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.throws(() => migration.runtimeRoleSql("postgres", "a".repeat(32)));
  assert.throws(() => migration.runtimeRoleSql("news_app", "REPLACE_" + "a".repeat(32)));
  assert.equal(migration.runtimeRoleSql("news_app", "a".repeat(32) + "\\'").literal,
    "E'" + "a".repeat(32) + "\\\\'''" );
});

test("API capacity returns 429 and releases a connection only once", () => {
  let time = 0;
  const middleware = createApiCapacityMiddleware({ maxConcurrent: 1, requestsPerSecond: 10, now: () => time });
  function response() {
    const res = new EventEmitter();
    res.set = () => res; res.status = code => { res.code = code; return res; }; res.json = () => res;
    return res;
  }
  const one = response(); let accepted = 0;
  middleware({ path: "/news" }, one, () => accepted++);
  const rejected = response();
  middleware({ path: "/news" }, rejected, () => assert.fail("over capacity"));
  assert.equal(rejected.code, 429);
  one.emit("finish"); one.emit("close");
  middleware({ path: "/news" }, response(), () => accepted++);
  assert.equal(accepted, 2);
  middleware({ path: "/health" }, response(), () => accepted++);
  assert.equal(accepted, 3);
  middleware({ path: "/health" }, response(), () => accepted++);
  const probeOverload = response();
  middleware({ path: "/health" }, probeOverload, () => assert.fail("unbounded health probes"));
  assert.equal(probeOverload.code, 429);
});
