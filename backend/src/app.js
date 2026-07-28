const express = require("express");

const config = require("./config");
const { query } = require("./db");
const {
  getInvestorFlowByDate,
  runInvestorFlowCollectionCycle
} = require("./investorFlowService");
const { fetchKospiMarketCapSnapshot } = require("./krxUniverseService");
const { refreshInvestorFlowUniverse } = require("./investorFlowUniverseService");
const { getMarketIndices } = require("./marketIndexService");
const {
  createManualArticle,
  createManualArticlesBulk,
  getLatestArticles,
  getLatestBriefing,
  getLatestRun
} = require("./newsService");
const {
  saveAnalysis,
  getAnalysisByDate
} = require("./aiAnalysisService");
const {
  saveBrokerageReport,
  saveBrokerageReportsBulk,
  getBrokerageReports
} = require("./brokerageReportService");
const {
  createAdminAuthMiddleware,
  securityHeaders
} = require("./security");

function parseLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit, 10);

  if (Number.isNaN(parsed)) {
    return 10;
  }

  return Math.max(1, Math.min(parsed, 10));
}

function createApp() {
  const app = express();
  const requireAdminApiKey = createAdminAuthMiddleware(config.adminApiKey);

  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "256kb", strict: true }));

  app.get("/health", async (_req, res) => {
    try {
      await query("SELECT 1");

      res.json({
        status: "ok",
        service: "backend",
        timestamp: new Date().toISOString(),
        database: "ok"
      });
    } catch (_error) {
      res.status(503).json({
        status: "degraded",
        service: "backend",
        timestamp: new Date().toISOString(),
        database: "unreachable"
      });
    }
  });

  app.get("/message", async (_req, res, next) => {
    try {
      const latestRun = await getLatestRun();

      res.json({
        message: "News digest backend is collecting and summarizing articles.",
        latestRun
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/market-indices", async (_req, res, next) => {
    try {
      const payload = await getMarketIndices();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/stocks/kospi", async (_req, res, next) => {
    try {
      const snapshot = await fetchKospiMarketCapSnapshot();

      res.json({
        market: "KOSPI",
        asOfDate: snapshot.date || null,
        source: snapshot.source || null,
        count: snapshot.items?.length || 0,
        items: snapshot.items || []
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/news", async (req, res, next) => {
    try {
      const payload = await getLatestArticles({
        limit: parseLimit(req.query.limit),
        category: req.query.category,
        date: req.query.date
      });

      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/news", requireAdminApiKey, async (req, res, next) => {
    try {
      const payload = await createManualArticle(req.body || {});
      res.status(payload.inserted ? 201 : 200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/news/bulk", requireAdminApiKey, async (req, res, next) => {
    try {
      const payload = await createManualArticlesBulk(req.body?.items || []);
      res.status(payload.failed === 0 ? 201 : 207).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/briefing/latest", async (req, res, next) => {
    try {
      const briefing = await getLatestBriefing({
        date: req.query.date
      });
      res.json(briefing);
    } catch (error) {
      next(error);
    }
  });

  app.get("/investor-flows/kospi", async (req, res, next) => {
    try {
      const payload = await getInvestorFlowByDate({
        date: req.query.date,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });


  app.get("/brokerage-reports", async (req, res, next) => {
    try {
      const payload = await getBrokerageReports({
        date: req.query.date,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        stockCode: req.query.stockCode,
        brokerage: req.query.brokerage,
        q: req.query.q,
        limit: req.query.limit
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/brokerage-reports", requireAdminApiKey, async (req, res, next) => {
    try {
      const payload = await saveBrokerageReport(req.body || {});
      res.status(201).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/brokerage-reports/bulk", requireAdminApiKey, async (req, res, next) => {
    try {
      const payload = await saveBrokerageReportsBulk(req.body?.items || []);
      res.status(payload.failed === 0 ? 201 : 207).json(payload);
    } catch (error) {
      next(error);
    }
  });
  app.get("/ai-analysis", async (req, res, next) => {
    try {
      const payload = await getAnalysisByDate(req.query.date);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/ai-analysis", requireAdminApiKey, async (req, res, next) => {
    try {
      const { date, title, category, content } = req.body || {};
      const payload = await saveAnalysis({ date, title, category, content });
      res.status(201).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post("/investor-flows/collect", requireAdminApiKey, async (_req, res, next) => {
    try {
      const universe = await refreshInvestorFlowUniverse();
      const collection = await runInvestorFlowCollectionCycle();

      res.json({
        universe: {
          count: universe.length,
          top3: universe.slice(0, 3).map((s) => `${s.stockName} (${s.stockCode})`)
        },
        collection
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    console.error("Unhandled API error", error);

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Internal server error"
    });
  });

  return app;
}

module.exports = {
  createApp
};
