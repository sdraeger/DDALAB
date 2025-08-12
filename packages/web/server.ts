import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import httpProxy from "http-proxy";
import type { ServerOptions } from "http-proxy";
import { spawn, ChildProcess } from "child_process";
import { IncomingMessage, ServerResponse } from "http";
import { getEnvVar } from "shared/lib/utils/env";
import logger from "shared/lib/utils/logger";
import { Writable } from "stream";

// --- Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const nextDevPort = 3001; // Internal port for Next.js dev server
const mainPort = 3000; // Port the proxy server will listen on (or get from env)
const apiUrl = getEnvVar("API_URL"); // Your API endpoint (e.g., http://localhost:8001)
const nextTarget = `http://localhost:${nextDevPort}`;

if (!apiUrl) {
  logger.error("API_URL environment variable is not set!");
  process.exit(1);
}

// --- Start Next.js Dev Server ---
logger.info(`Starting Next.js dev server on internal port ${nextDevPort}...`);
const nextDevServer: ChildProcess = spawn(
  "npx",
  ["next", "dev", "--port", nextDevPort.toString()],
  {
    stdio: ["ignore", "inherit", "inherit"], // pipe stdout/stderr from next dev to this process
    shell: true, // Use shell for npx compatibility across platforms
  }
);

// --- Create Proxy Server Instance ---
// Note: We don't set a default target here, as it's determined per request.
const proxy = httpProxy.createProxyServer({
  ws: true, // Enable WebSocket proxying (important for Next.js HMR)
  secure: false, // Set to true if your targets use valid HTTPS certs not self-signed
  // changeOrigin: true // Consider adding if API_URL is on a different domain/port host header needs changing
});

// --- Error Handling for the Proxy ---
// Listen for errors from the proxy TARGETS (e.g., connection refused)
proxy.on(
  "error",
  (
    err: Error,
    req: IncomingMessage,
    res: ServerResponse | Writable,
    target?
  ) => {
    // Use imported Writable
    const targetUrl =
      typeof target === "string" ? target : JSON.stringify(target);

    logger.error(
      `Proxy error for target [${targetUrl ?? "unknown"}]:`,
      err.message
    );

    if (res instanceof ServerResponse) {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
      }
      res.end("Proxy Error: Could not connect to the target service.");
    } else if (res instanceof Writable) {
      logger.warn("WebSocket proxy error. Closing connection.");

      if (typeof res.end === "function") {
        const isDestroyed =
          "destroyed" in res &&
          typeof res.destroyed === "boolean" &&
          res.destroyed;

        if (!isDestroyed) {
          try {
            res.end();
          } catch (endErr) {
            logger.error(
              "Error calling res.end() on WebSocket socket:",
              endErr
            );
            // If end fails, forcefully destroy if possible
            if (typeof res.destroy === "function") {
              try {
                res.destroy();
              } catch (destroyErr) {
                logger.error(
                  "Error calling res.destroy() on WebSocket socket:",
                  destroyErr
                );
              }
            }
          }
        } else {
          logger.debug("WebSocket socket already destroyed.");
        }
      } else {
        logger.error(
          "Response object in WebSocket error handler is not a proper Writable stream (no end method)."
        );
      }
    } else {
      logger.error("Unknown response type in proxy error handler.");
    }
  }
);

// --- Create the Main HTTP Server ---
const server = http.createServer(
  (req: IncomingMessage, res: ServerResponse) => {
    const isBackend =
      req.url?.startsWith("/backend/") || req.url === "/backend";
    const isGraphql = req.url?.startsWith("/graphql");
    let target: string = nextTarget;
    if (isBackend || isGraphql) {
      // Normalize /backend prefix to root for the Python API
      if (isBackend && req.url) {
        req.url = req.url.replace(/^\/backend\//, "/");
      }
      target = apiUrl;
    }
    const options: ServerOptions = { target };

    // Add changeOrigin specifically for the API if needed
    if (target === apiUrl) {
      options.changeOrigin = true; // Often needed when proxying to different hosts/ports
      logger.debug(
        `Proxying API request ${req.method} ${req.url} to ${target}`
      );
    } else {
      logger.debug(
        `Proxying Next.js request ${req.method} ${req.url} to ${target}`
      );
    }

    try {
      // Proxy the HTTP request
      proxy.web(req, res, options);
    } catch (error) {
      // Catch synchronous errors during proxy.web setup if any (rare)
      logger.error("Error occurred before proxying:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end("Internal Server Error");
    }
  }
);

// --- Handle WebSocket Upgrades ---
server.on("upgrade", (req, socket, head) => {
  // Only proxy WebSocket connections intended for Next.js HMR (usually not API)
  const isBackend = req.url?.startsWith("/backend/") || req.url === "/backend";
  const isGraphql = req.url?.startsWith("/graphql");
  if (!isBackend && !isGraphql) {
    logger.debug(
      `Proxying WebSocket upgrade request ${req.url} to ${nextTarget}`
    );
    try {
      proxy.ws(req, socket, head, { target: nextTarget });
    } catch (error) {
      logger.error("Error during WebSocket proxy setup:", error);
      socket.destroy();
    }
  } else {
    logger.warn(`WebSocket upgrade request for ${req.url} blocked.`);
    // Explicitly destroy the socket if not proxying
    socket.destroy();
  }
});

// --- Start the Main Proxy Server ---
server.listen(mainPort, () => {
  logger.info(`🚀 Proxy server listening on http://localhost:${mainPort}`);
  logger.info(` -> Forwarding Next.js requests to ${nextTarget}`);
  logger.info(` -> Forwarding /graphql requests to ${apiUrl}`);
});

// --- Graceful Shutdown ---
const shutdown = () => {
  logger.info("Shutting down server...");
  server.close(() => {
    logger.info("HTTP server closed.");
    if (nextDevServer && !nextDevServer.killed) {
      logger.info("Stopping Next.js dev server...");
      const killed = nextDevServer.kill("SIGTERM"); // Send SIGTERM for graceful shutdown
      if (!killed) {
        logger.warn(
          "Failed to kill Next.js dev server gracefully, forcing SIGKILL."
        );
        nextDevServer.kill("SIGKILL");
      }
    }
    process.exit(0);
  });

  // Force shutdown after a timeout
  setTimeout(() => {
    logger.warn("Forcing shutdown after timeout...");
    process.exit(1);
  }, 5000); // 5 seconds timeout
};

process.on("SIGINT", shutdown); // Ctrl+C
process.on("SIGTERM", shutdown); // Termination signal
