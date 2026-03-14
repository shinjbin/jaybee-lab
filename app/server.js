const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const distPath = path.join(__dirname, "dist");

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(
  express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
      }
    }
  })
);

app.get("*", (_req, res) => {
  res.type("html");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
