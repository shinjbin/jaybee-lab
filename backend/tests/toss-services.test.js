const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function loadService(name, overrides, globals = {}) {
  const filename = path.resolve(__dirname, "../src", name);
  const originalRequire = createRequire(filename);
  const context = { module: { exports: {} }, require: (id) => overrides[id] || originalRequire(id),
    console: { warn() {}, log() {} }, Date, Intl, URL, URLSearchParams, AbortSignal, ...globals };
  vm.runInNewContext(readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}

test("Toss index uses previous trading close when today's candle is absent", async () => {
  const service = loadService("marketIndexService.js", {
    "./db": require("./market-snapshot-db").snapshotDb(),
    "./config": { tossIndexHistoryDays: 30, twelveDataSeries: [] },
    "./tossClient": {
      fetchIndexPrice: async () => ({ lastPrice: "2800", timestamp: "2026-09-14T10:00:00+09:00" }),
      fetchIndexDailyChartPrice: async () => [
        { timestamp: "2026-09-11T09:00:00+09:00", openPrice: "2,650", highPrice: "2750", lowPrice: "2640", closePrice: "2700" },
        { timestamp: "2026-09-10T09:00:00+09:00", closePrice: "2600" }
      ]
    }
  });
  const { items } = await service.getMarketIndices();
  assert.equal(items[0].change, 100);
  assert.equal(items[0].provider, "Toss Securities");
  assert.equal(items[0].updatedAt, "2026-09-14T10:00:00+09:00");
  assert.equal(items[0].history[0].date, "2026-09-10");
  assert.equal(items[0].history[1].open, 2650);
  assert.equal(items[0].history[1].high, 2750);
  assert.equal(items[0].history[1].low, 2640);
  assert.equal(items[0].history[1].close, 2700);
  assert.equal(items[0].history[0].open, null);
});

function flowService(client, saved, enabled = true, universe = [{ stockCode: "005930", stockName: "Samsung" }]) {
  return loadService("investorFlowService.js", {
    "./config": { tossEnabled: enabled, tossMarketFlowEnabled: true, tossFlowWeeklyWindowDays: 7 },
    "./db": { query: async (_sql, values) => { saved.push(values); return { rows: [] }; } },
    "./investorFlowUniverseService": { getInvestorFlowUniverse: async () => universe },
    "./tossClient": client
  });
}

test("flow collector stores response date, signed estimates, zero updates and source metadata", async () => {
  const saved = [];
  const service = flowService({
    fetchInvestorTradeByStockDaily: async () => [{ date: "2024-01-05", updatedAt: "2024-01-08T09:00:00+09:00",
      foreigner: { netBuyVolume: "-10" }, institution: { netBuyVolume: "0" } }],
    fetchStockClosingPrice: async (_symbol, date) => { assert.equal(date, "2024-01-05"); return "70000"; },
    fetchCurrentPrice: async () => assert.fail("historical flow must not use today's price")
  }, saved);
  const result = await service.runInvestorFlowCollectionCycle();
  assert.equal(result.tradeDate, "2024-01-05");
  assert.equal(saved.length, 2);
  assert.equal(saved[0][0], "2024-01-05");
  assert.equal(saved[0][6], "-700000");
  assert.equal(saved[0][7], "-10");
  assert.equal(saved[0][9], "quantity_x_price");
  assert.equal(saved[1][6], "0");
  assert.equal(JSON.parse(saved[0][10]).market_scope, "KRX+NXT");
});

test("missing historical candle preserves volume but does not invent an amount", async () => {
  const saved = [];
  const service = flowService({
    fetchInvestorTradeByStockDaily: async () => [{ date: "2024-01-05", foreigner: { netBuyVolume: "5" }, institution: null }],
    fetchStockClosingPrice: async () => null
  }, saved);
  await service.runInvestorFlowCollectionCycle();
  assert.equal(saved.length, 1);
  assert.equal(saved[0][6], null);
  assert.equal(saved[0][7], "5");
  assert.equal(saved[0][9], null);
});

test("flow collector requests and stores all 100 market-cap-ranked stocks", async () => {
  const saved = [];
  const universe = Array.from({ length: 100 }, (_, index) => ({
    stockCode: String(index + 1).padStart(6, "0"), stockName: `Stock ${index + 1}`
  }));
  const requested = [];
  const today = new Date().toISOString().slice(0, 10);
  const service = flowService({
    fetchInvestorTradeByStockDaily: async (stockCode) => {
      requested.push(stockCode);
      return [{ date: today, foreigner: { netBuyVolume: "1" }, institution: { netBuyVolume: "-1" } }];
    },
    fetchCurrentPrice: async () => null
  }, saved, true, universe);

  const result = await service.runInvestorFlowCollectionCycle();

  assert.equal(requested.length, 100);
  assert.equal(new Set(requested).size, 100);
  assert.equal(result.collectionUniverseCount, 100);
  assert.equal(result.successfulStocks, 100);
  assert.equal(result.failedStockCodes.length, 0);
  assert.equal(saved.length, 200);
});

test("disabled flow collection skips calls; all upstream failures are reported", async () => {
  const saved = [];
  const disabled = flowService({}, saved, false);
  assert.equal((await disabled.runInvestorFlowCollectionCycle()).skipped, true);
  const failing = flowService({ fetchInvestorTradeByStockDaily: async () => { throw new Error("unauthorized"); } }, saved);
  await assert.rejects(failing.runInvestorFlowCollectionCycle(), /failed for all stocks/);
  assert.equal(saved.length, 0);
});


test("persisted market snapshot serves immediately and survives provider outage", async () => {
  const oldDate = new Date(Date.now() - 3600000).toISOString();
  const payload = { symbol: "KOSPI", price: 2800, history: [{ date: "2026-01-02", close: 2800 }] };
  const db = require("./market-snapshot-db").snapshotDb([{ symbol: "KOSPI", payload, refreshed_at: oldDate }]);
  let calls = 0;
  const service = loadService("marketIndexService.js", {
    "./db": db, "./config": { twelveDataSeries: [], marketCacheTtlMs: 900000 },
    "./tossClient": {
      fetchIndexPrice: async () => { calls++; throw new Error("upstream unavailable"); },
      fetchIndexDailyChartPrice: async () => []
    }
  });
  const result = await service.getMarketIndices();
  assert.equal(result.items[0].price, 2800);
  assert.equal(result.generatedAt, oldDate);
  await service.runMarketIndexCollectionCycle();
  assert.equal(calls, 1);
  assert.equal(db.snapshots.get("KOSPI").payload.price, 2800);
});

test("fresh persisted snapshot does not call providers, even after a service restart", async () => {
  const db = require("./market-snapshot-db").snapshotDb([{ symbol: "KOSPI",
    payload: { symbol: "KOSPI", price: 2800, history: [] }, refreshed_at: new Date().toISOString() }]);
  let calls = 0;
  const overrides = { "./db": db, "./config": { twelveDataSeries: [] },
    "./tossClient": { fetchIndexPrice: async () => { calls++; }, fetchIndexDailyChartPrice: async () => [] } };
  await loadService("marketIndexService.js", overrides).getMarketIndices();
  await loadService("marketIndexService.js", overrides).getMarketIndices();
  assert.equal(calls, 0);
});

test("incremental market collection updates overlap and retains older history", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const history = [{ date: "2025-01-02", open: 10, high: 12, low: 9, close: 11 },
    { date: yesterday, open: 20, high: 22, low: 19, close: 21 }];
  const db = require("./market-snapshot-db").snapshotDb([{ symbol: "KOSPI", payload: { history },
    refreshed_at: new Date(Date.now() - 3600000).toISOString() }]);
  let count;
  const service = loadService("marketIndexService.js", {
    "./db": db, "./config": { twelveDataSeries: [], tossIndexHistoryDays: 420 },
    "./tossClient": {
      fetchIndexPrice: async () => ({ lastPrice: 24, timestamp: today }),
      fetchIndexDailyChartPrice: async (options) => {
        count = options.count;
        return [{ timestamp: yesterday, openPrice: 20, highPrice: 23, lowPrice: 19, closePrice: 22 },
          { timestamp: today, openPrice: 22, highPrice: 25, lowPrice: 21, closePrice: 24 }];
      }
    }
  });
  await service.runMarketIndexCollectionCycle();
  assert.ok(count >= 5 && count < 10);
  const saved = db.snapshots.get("KOSPI").payload;
  assert.equal(saved.history.length, 3);
  assert.equal(saved.history[0].close, 11);
  assert.equal(saved.history[1].close, 22);
  assert.equal(saved.change, 2);
  assert.equal(service.incrementalCount(null, 420), 420);
  assert.equal(service.incrementalCount({ history: [{ date: "2020-01-01" }] }, 420), 420);
});


test("slow upstream refresh does not block persisted market response", async () => {
  const db = require("./market-snapshot-db").snapshotDb([{ symbol: "KOSPI",
    payload: { symbol: "KOSPI", price: 2800, history: [] },
    refreshed_at: new Date(Date.now() - 3600000).toISOString() }]);
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const service = loadService("marketIndexService.js", {
    "./db": db, "./config": { twelveDataSeries: [], tossIndexHistoryDays: 420 },
    "./tossClient": {
      fetchIndexPrice: () => pending,
      fetchIndexDailyChartPrice: async () => []
    }
  });
  const result = await service.getMarketIndices();
  assert.equal(result.items[0].price, 2800);
  finish({ lastPrice: 2900, timestamp: new Date().toISOString() });
  await service.runMarketIndexCollectionCycle();
  assert.equal(db.snapshots.get("KOSPI").payload.price, 2900);
});

test("Twelve Data requests only the missing window and persists revised candles", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const db = require("./market-snapshot-db").snapshotDb([
    { symbol: "KOSPI", payload: { symbol: "KOSPI", price: 2800 }, refreshed_at: new Date().toISOString() },
    { symbol: "TEST", payload: { history: [{ date: "2025-01-02", close: 10 }, { date: yesterday, close: 20 }] },
      refreshed_at: new Date(Date.now() - 3600000).toISOString() }
  ]);
  let requested;
  const service = loadService("marketIndexService.js", {
    "./db": db, "./config": { twelveDataSeries: [{ symbol: "TEST", name: "Test", market: "US" }],
      twelveDataBaseUrl: "https://example.com", twelveDataHistoryDays: 420 },
    "./tossClient": {}
  }, { fetch: async (url) => {
    requested = Number(url.searchParams.get("outputsize"));
    return { ok: true, json: async () => ({ values: [
      { datetime: yesterday, open: 20, high: 23, low: 19, close: 22 },
      { datetime: today, open: 22, high: 25, low: 21, close: 24 }
    ] }) };
  } });
  await service.runMarketIndexCollectionCycle();
  assert.ok(requested >= 5 && requested < 10);
  const saved = db.snapshots.get("TEST").payload;
  assert.equal(saved.history.length, 3);
  assert.equal(saved.history[0].close, 10);
  assert.equal(saved.history[1].close, 22);
  assert.equal(saved.change, 2);
});
