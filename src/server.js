const express = require("express");
const path = require("path");
const { analyzeDirectory } = require("./analyzer");
const { buildGraph } = require("./graph-builder");

function createServer(targetDir, options = {}) {
  const app = express();
  const port = options.port || 3000;

  // Cache analysis results
  let cachedGraph = null;
  let analyzing = false;

  app.use(express.static(path.join(__dirname, "..", "public")));

  // API: get the full graph
  app.get("/api/graph", async (req, res) => {
    try {
      if (!cachedGraph) {
        analyzing = true;
        const analysis = await analyzeDirectory(targetDir);
        cachedGraph = buildGraph(analysis);
        analyzing = false;
      }
      res.json(cachedGraph);
    } catch (err) {
      analyzing = false;
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  // API: re-analyze (invalidate cache)
  app.post("/api/refresh", async (req, res) => {
    try {
      analyzing = true;
      cachedGraph = null;
      const analysis = await analyzeDirectory(targetDir);
      cachedGraph = buildGraph(analysis);
      analyzing = false;
      res.json(cachedGraph);
    } catch (err) {
      analyzing = false;
      res.status(500).json({ error: err.message });
    }
  });

  // API: status
  app.get("/api/status", (req, res) => {
    res.json({
      targetDir,
      analyzing,
      hasData: !!cachedGraph,
      stats: cachedGraph?.stats || null,
    });
  });

  // SPA fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return { app, port };
}

module.exports = { createServer };
