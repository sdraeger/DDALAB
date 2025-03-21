import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local file
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

import https from "https";
import fs from "fs";
import httpProxy from "http-proxy";
import { exec, spawn, ChildProcess } from "child_process";
import { getNumericEnvVar, getEnvVar } from "./lib/utils/env.ts";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";

const port = getNumericEnvVar("PORT", 3000);
const nextDevPort = 3001; // Internal port for Next.js dev server

// SSL configuration
const keyPath = getEnvVar("WEB_SSL_KEY_PATH");
const certPath = getEnvVar("WEB_SSL_CERT_PATH");

// Function to sync users between SQLite and Directus
function syncDirectusUsers(): void {
  console.log("Running user synchronization...");
  const syncScript = path.join(__dirname, "scripts", "syncDirectusUsers.js");

  exec(`node ${syncScript}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`User sync error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`User sync stderr: ${stderr}`);
      return;
    }
    console.log(`User sync completed: ${stdout}`);
  });
}

// Start Next.js on internal port
const dev = process.env.NODE_ENV !== "production";
const nextDevServer: ChildProcess = spawn(
  "npx",
  ["next", "dev", "--port", nextDevPort.toString()],
  {
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
  }
);

// Log Next.js server info
console.log(`Starting Next.js dev server on internal port ${nextDevPort}...`);

// Handle process termination
process.on("SIGINT", () => {
  console.log("Shutting down servers...");
  nextDevServer.kill();
  process.exit(0);
});

// Create HTTPS proxy
let httpsOptions: https.ServerOptions;
try {
  httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
  console.log("SSL certificates loaded successfully");
} catch (err) {
  console.error(
    "SSL certificates not found or not readable:",
    (err as Error).message
  );
  process.exit(1);
}

// Create proxy server
const proxy = httpProxy.createProxyServer({
  target: `http://localhost:${nextDevPort}`,
  ws: true, // Enable WebSocket proxying
  secure: false,
});

// Log proxy errors
(proxy as any).on(
  "error",
  (err: Error, req: IncomingMessage, res: ServerResponse) => {
    console.error("Proxy error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Proxy error occurred");
  }
);

// Handle websocket upgrade
(proxy as any).on(
  "proxyReqWs",
  (
    proxyReq: IncomingMessage,
    req: IncomingMessage,
    socket: Socket,
    options: Record<string, unknown>,
    head: Buffer
  ) => {
    console.log("Proxying WebSocket:", req.url);
  }
);

// Create HTTPS server
const server = https.createServer(
  httpsOptions,
  (req: IncomingMessage, res: ServerResponse) => {
    // Proxy all requests to Next.js
    proxy.web(req, res, {
      target: `http://localhost:${nextDevPort}`,
    });
  }
);

// Handle WebSocket upgrade
server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
  proxy.ws(req, socket, head);
});

// Start HTTPS server
server.listen(port, () => {
  console.log(`> HTTPS proxy ready on https://localhost:${port}`);
  console.log(
    `> Proxying to Next.js dev server on http://localhost:${nextDevPort}`
  );
});
