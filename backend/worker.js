const config = require("./src/config");
const { closePool, initializeDatabaseWithRetry } = require("./src/db");
const { runInvestorFlowCollectionCycle } = require("./src/investorFlowService");
const { runCollectionCycle } = require("./src/newsService");

let isRunning = false;
let intervalHandle = null;

async function executeCycle(trigger) {
  if (isRunning) {
    console.log(`Skipping ${trigger} cycle because another run is still active.`);
    return;
  }

  isRunning = true;

  try {
    const news = await runCollectionCycle(trigger);
    const investorFlows = await runInvestorFlowCollectionCycle();
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
