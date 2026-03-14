const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "backend",
    timestamp: new Date().toISOString()
  });
});

app.get("/message", (_req, res) => {
  res.json({
    message: "Backend is ready for future business logic."
  });
});

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
