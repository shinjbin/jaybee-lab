const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function loadService(name, overrides) {
  const filename = path.resolve(__dirname, "../src", name);
  const originalRequire = createRequire(filename);
  const context = { module: { exports: {} }, require: (id) => overrides[id] || originalRequire(id),
    console: { warn() {}, log() {} }, Date, Intl, URL, URLSearchParams, AbortSignal };
  vm.runInNewContext(readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}

test("Toss index uses previous trading close when today's candle is absent", async () => {
  const service = loadService("marketIndexService.js", {
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
