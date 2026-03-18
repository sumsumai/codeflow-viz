#!/usr/bin/env node

const path = require("path");
const { createServer } = require("../src/server");

const args = process.argv.slice(2);
let targetDir = process.cwd();
let port = 3000;
let noBrowser = false;

// Parse args
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--no-open") {
    noBrowser = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
  codeflow-viz - Instantly visualize any codebase as an interactive node graph

  Usage:
    npx codeflow-viz [directory] [options]

  Options:
    -p, --port <port>   Port to run the server on (default: 3000)
    --no-open           Don't auto-open the browser
    -h, --help          Show this help message

  Examples:
    npx codeflow-viz                  # Analyze current directory
    npx codeflow-viz ./src            # Analyze a subfolder
    npx codeflow-viz . -p 8080        # Custom port
`);
    process.exit(0);
  } else if (!args[i].startsWith("-")) {
    targetDir = path.resolve(args[i]);
  }
}

const { app } = createServer(targetDir, { port });

app.listen(port, () => {
  const url = `http://localhost:${port}`;
  const dirDisplay = targetDir.length > 36
    ? "..." + targetDir.slice(-33)
    : targetDir;

  console.log(`
  ╔════════════════════════════════════════════╗
  ║         c o d e f l o w - v i z            ║
  ╠════════════════════════════════════════════╣
  ║                                            ║
  ║  Analyzing: ${dirDisplay.padEnd(30)}║
  ║  Server:    ${url.padEnd(30)}║
  ║                                            ║
  ╚════════════════════════════════════════════╝
`);

  if (!noBrowser) {
    import("open").then((mod) => mod.default(url)).catch(() => {
      console.log(`  Open ${url} in your browser`);
    });
  }
});
