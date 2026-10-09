const config = require("./src/config");
const { initializeDatabaseWithRetry } = require("./src/db");
const { createApp } = require("./src/app");
const { createStartupHealth } = require("./src/startupHealth");

async function startServer() {
  await initializeDatabaseWithRetry();

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
    createStartupHealth().report().catch(() => {
      console.error("Startup API health check failed.");
    });
  });

  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
}

startServer().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
