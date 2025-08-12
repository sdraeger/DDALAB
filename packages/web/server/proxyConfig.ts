import httpProxy from "http-proxy";
import { IncomingMessage, ServerResponse } from "http";
import { Writable } from "stream";
import logger from "shared/lib/utils/logger";

export interface ProxyConfig {
  apiUrl: string;
  nextTarget: string;
}

export class ProxyManager {
  private proxy: httpProxy;
  private config: ProxyConfig;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.proxy = httpProxy.createProxyServer({
      ws: true, // Enable WebSocket proxying (important for Next.js HMR)
      secure: false, // Set to true if your targets use valid HTTPS certs
    });

    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.proxy.on(
      "error",
      (
        err: Error,
        req: IncomingMessage,
        res: ServerResponse | Writable,
        target?
      ) => {
        const targetUrl =
          typeof target === "string" ? target : JSON.stringify(target);

        logger.error(
          `Proxy error for target [${targetUrl ?? "unknown"}]:`,
          err.message
        );

        if (res instanceof ServerResponse) {
          this.handleHttpError(res);
        } else if (res instanceof Writable) {
          this.handleWebSocketError(res);
        } else {
          logger.error("Unknown response type in proxy error handler.");
        }
      }
    );
  }

  private handleHttpError(res: ServerResponse): void {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end("Proxy Error: Could not connect to the target service.");
  }

  private handleWebSocketError(res: Writable): void {
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
          logger.error("Error calling res.end() on WebSocket socket:", endErr);
          this.destroySocket(res);
        }
      } else {
        logger.debug("WebSocket socket already destroyed.");
      }
    } else {
      logger.error(
        "Response object in WebSocket error handler is not a proper Writable stream (no end method)."
      );
    }
  }

  private destroySocket(res: Writable): void {
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

  handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const isBackend =
      req.url?.startsWith("/backend/") || req.url === "/backend";
    const isApi = req.url?.startsWith("/api/") || req.url === "/api";
    const isGraphql = req.url?.startsWith("/graphql");
    let target = this.config.nextTarget;

    if (isBackend || isApi || isGraphql) {
      // Normalize /backend prefix to root for the Python API
      if (isBackend && req.url) {
        req.url = req.url.replace(/^\/backend\//, "/");
      }
      target = this.config.apiUrl;
    }

    const options: httpProxy.ServerOptions = { target };

    // Add changeOrigin specifically for the API if needed
    if (target === this.config.apiUrl) {
      options.changeOrigin = true;
      logger.debug(
        `Proxying API request ${req.method} ${req.url} to ${target}`
      );
    } else {
      logger.debug(
        `Proxying Next.js request ${req.method} ${req.url} to ${target}`
      );
    }

    try {
      this.proxy.web(req, res, options);
    } catch (error) {
      logger.error("Error occurred before proxying:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end("Internal Server Error");
    }
  }

  handleWebSocketUpgrade(req: IncomingMessage, socket: any, head: any): void {
    // Only proxy WebSocket connections intended for Next.js HMR (not API)
    const isBackend =
      req.url?.startsWith("/backend/") || req.url === "/backend";
    const isApi = req.url?.startsWith("/api/") || req.url === "/api";
    const isGraphql = req.url?.startsWith("/graphql");
    if (!isBackend && !isApi && !isGraphql) {
      logger.debug(
        `Proxying WebSocket upgrade request ${req.url} to ${this.config.nextTarget}`
      );
      try {
        this.proxy.ws(req, socket, head, { target: this.config.nextTarget });
      } catch (error) {
        logger.error("Error during WebSocket proxy setup:", error);
        socket.destroy();
      }
    } else {
      logger.warn(`WebSocket upgrade request for ${req.url} blocked.`);
      socket.destroy();
    }
  }
}
