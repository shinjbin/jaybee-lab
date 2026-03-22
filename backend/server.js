const config = require("./src/config");
const { initializeDatabaseWithRetry } = require("./src/db");
const { createApp } = require("./src/app");

async function startServer() {
  await initializeDatabaseWithRetry();

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
