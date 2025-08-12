const dotenv = require("dotenv");
const { createServer } = require("http");
const httpProxy = require("http-proxy");
const { join } = require("path");
const fs = require("fs");

// Load environment variables
const envPath = join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
  console.log("Loaded .env from:", envPath);
} else {
  console.warn(".env not found at:", envPath);
}

// Debug environment variables
console.log("Environment debug:");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("API_URL:", process.env.API_URL);

// Load Next.js
const next = require("next");

// Create Next.js app instance
const app = next({
  dev: true, // Use dev mode to avoid requiring a prebuild
  dir: __dirname,
  port: 3000, // Match EXPOSE in Dockerfile
});

// Get the request handler
const handle = app.getRequestHandler();

// Create API proxy (for both /api and /graphql)
const apiUrl = process.env.API_URL || "http://localhost:8001";
const apiProxy = httpProxy.createProxyServer({
  target: apiUrl,
  changeOrigin: true,
  secure: false,
});

// Prepare and start the app
app
  .prepare()
  .then(() => {
    console.log("🚀 Next.js app prepared successfully");

    // Create an HTTP server
    const server = createServer((req, res) => {
      const url = req.url || "";

      // Proxy backend requests
      if (
        url.startsWith("/backend/") ||
        url === "/backend" ||
        url.startsWith("/graphql")
      ) {
        const originalUrl = url;
        // Normalize /backend prefix to root for the Python API
        if (url.startsWith("/backend/")) {
          req.url = url.replace(/^\/backend\//, "/");
        }
        console.log(`[Proxy] ${originalUrl} -> ${apiUrl}${req.url}`);
        apiProxy.web(req, res, (err) => {
          console.error("Proxy error:", err);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain" });
          }
          res.end("Bad Gateway");
        });
        return;
      }

      // Otherwise, let Next.js handle it
      handle(req, res);
    });

    // Start listening on port 3000
    server.listen(3000, (err) => {
      if (err) throw err;
      console.log("✅ Next.js app started successfully on http://0.0.0.0:3000");
    });
  })
  .catch((err) => {
    console.error("❌ Error starting Next.js:", err);
    console.error("Error stack:", err.stack);
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    if (err.cause) {
      console.error("Error cause:", err.cause);
    }

    process.exit(1);
  });
