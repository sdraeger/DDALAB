import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local file
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

import httpProxy from "http-proxy";
import { spawn, ChildProcess } from "child_process";
import { IncomingMessage, ServerResponse } from "http";

import logger from "./lib/utils/logger.ts";

const nextDevPort = 3001; // Internal port for Next.js dev server

// Start Next.js on internal port
const nextDevServer: ChildProcess = spawn(
  "npx",
  ["next", "dev", "--port", nextDevPort.toString()],
  {
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
  }
);

// Log Next.js server info
logger.info(`Starting Next.js dev server on internal port ${nextDevPort}...`);

// Handle process termination
process.on("SIGINT", () => {
  logger.info("Shutting down web server...");
  nextDevServer.kill();
  process.exit(0);
});

// Create proxy server
const proxy = httpProxy.createProxyServer({
  target: `http://localhost:${nextDevPort}`,
  ws: true, // Enable WebSocket proxying
  secure: false,
});

proxy.on("proxyReq", (proxyReq, req) => {
  if (req.url?.startsWith("/graphql")) {
    proxyReq.setHeader("Host", "localhost:8001");
    proxy.target = "http://localhost:8001";
  }
});

// Log proxy errors
(proxy as any).on(
  "error",
  (err: Error, req: IncomingMessage, res: ServerResponse) => {
    logger.error("Proxy error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Proxy error occurred");
  }
);
