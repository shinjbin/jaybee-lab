const express = require("express");

const config = require("./config");
const { query } = require("./db");
const { getInvestorFlowByDate } = require("./investorFlowService");
const { getMarketIndices } = require("./marketIndexService");
const {
  getLatestArticles,
  getLatestBriefing,
  getLatestRun
} = require("./newsService");

function parseLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit, 10);

  if (Number.isNaN(parsed)) {
    return 10;
  }

  return Math.max(1, Math.min(parsed, 10));
}

function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/health", async (_req, res) => {
    try {
      await query("SELECT 1");

      res.json({
        status: "ok",
        service: "backend",
        timestamp: new Date().toISOString(),
        database: "ok",
        ai: {
          enabled: config.aiEnabled,
          model: config.aiEnabled ? config.openaiModel : null
        },
        scheduler: {
          intervalMinutes: Math.round(config.newsPollIntervalMs / 60000),
          provider: "gnews",
          endpoint: config.gnewsEndpoint,
          sourceCount: 1
        },
        marketIndices: {
          count: 1 + config.twelveDataSeries.length,
          providers: ["Korea Investment & Securities", "Twelve Data"],
          kisHistoryDays: config.kisIndexHistoryDays,
          twelveDataHistoryDays: config.twelveDataHistoryDays
        },
        kis: {
          enabled: config.kisEnabled && config.kisMarketFlowEnabled,
          environment: config.kisEnvironment,
          market: "KOSPI",
          topCount: config.kisFlowTopCount,
          universeCount: config.kisFlowUniverseCount,
          weeklyWindowDays: config.kisFlowWeeklyWindowDays
        }
      });
    } catch (error) {
      res.status(503).json({
        status: "degraded",
        service: "backend",
        timestamp: new Date().toISOString(),
        database: "unreachable",
        error: error.message
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
      const payload = await getInvestorFlowByDate(req.query.date);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    console.error("Unhandled API error", error);

    res.status(500).json({
      error: "Internal server error"
    });
  });

  return app;
}

module.exports = {
  createApp
};
