// Serves a built directory at / with the Content-Security-Policy of its .htaccess and a static host's cache headers.
// Usage: node serve.mjs <port> <dist directory>
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { cspOf } from "../../scripts/policy.mjs";

const [port, dir] = process.argv.slice(2);
if (!port || !dir) throw new Error("usage: serve.mjs <port> <dist directory>");
const root = resolve(dir);
const csp = cspOf(readFileSync(join(root, ".htaccess"), "utf8"));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = resolve(root, path.slice(1) || "index.html");
  let body;
  try {
    if (!file.startsWith(root)) throw new Error("outside the directory");
    body = readFileSync(file);
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "content-security-policy": csp,
    "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  response.end(body);
}).listen(Number(port), "127.0.0.1");
