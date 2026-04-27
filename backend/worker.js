const config = require("./src/config");
const { getSeoulDateParts, isWithinSeoulTimeWindow } = require("./src/dateUtils");
const { closePool, initializeDatabaseWithRetry } = require("./src/db");
const { runInvestorFlowCollectionCycle } = require("./src/investorFlowService");
const { runCollectionCycle } = require("./src/newsService");

let isRunning = false;
let intervalHandle = null;

function shouldCollectInvestorFlows(now = new Date()) {
  if (!config.kisEnabled || !config.kisMarketFlowEnabled) {
    return false;
  }

  return isWithinSeoulTimeWindow(
    config.kisFlowCollectionStartHour,
    config.kisFlowCollectionEndHour,
    now
  );
}

function getInvestorFlowSkipReason(now = new Date()) {
  const parts = getSeoulDateParts(now);

  return `outside investor flow collection window (${config.kisFlowCollectionStartHour}:00-${config.kisFlowCollectionEndHour}:59 KST, now ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")})`;
}

async function executeCycle(trigger) {
  if (isRunning) {
    console.log(`Skipping ${trigger} cycle because another run is still active.`);
    return;
  }

  isRunning = true;

  try {
    const news = await runCollectionCycle(trigger);
    let investorFlows = {
      enabled: config.kisEnabled && config.kisMarketFlowEnabled,
      skipped: true,
      reason: getInvestorFlowSkipReason()
    };

    if (shouldCollectInvestorFlows()) {
      investorFlows = await runInvestorFlowCollectionCycle();
    }

    console.log(
      `Collection cycle finished (${trigger})`,
      JSON.stringify({ news, investorFlows })
    );
  } catch (error) {
    console.error(`Collection cycle failed (${trigger})`, error);
  } finally {
    isRunning = false;
  }
}

async function shutdown(signal) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  console.log(`Received ${signal}, shutting down worker.`);
  await closePool();
  process.exit(0);
}

async function startWorker() {
  await initializeDatabaseWithRetry();
  await executeCycle("startup");

  intervalHandle = setInterval(() => {
    executeCycle("schedule");
  }, config.newsPollIntervalMs);

  console.log(
    `Worker polling every ${Math.round(config.newsPollIntervalMs / 60000)} minutes.`
  );
  const providerLogs = [];

  if (config.newsProviders.includes("gnews")) {
    providerLogs.push(`GNews (${config.gnewsEndpoint})`);
  }

  if (config.newsProviders.includes("yahoo-finance")) {
    providerLogs.push(
      `Yahoo Finance search (${config.yahooFinanceSearchTerms.join(", ")})`
    );
  }

  console.log(`News providers: ${providerLogs.join(" + ")}.`);
  console.log(
    `Investor flow collection window: ${config.kisFlowCollectionStartHour}:00-${config.kisFlowCollectionEndHour}:59 KST.`
  );
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

startWorker().catch((error) => {
  console.error("Failed to start worker", error);
  process.exit(1);
});
