const config = require("./src/config");
const { closePool, initializeDatabaseWithRetry } = require("./src/db");
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
    const result = await runCollectionCycle(trigger);
    console.log(`News cycle finished (${trigger})`, JSON.stringify(result));
  } catch (error) {
    console.error(`News cycle failed (${trigger})`, error);
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
    `News worker polling every ${Math.round(config.newsPollIntervalMs / 60000)} minutes.`
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
