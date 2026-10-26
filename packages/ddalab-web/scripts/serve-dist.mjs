// Serves dist/ under a mount path with the Content-Security-Policy of dist/.htaccess, as the smoke test
// (`npm run test:dist`) needs it. DIST_WASM_TYPE sets the Content-Type of .wasm files (application/wasm when unset);
// application/octet-stream stands for a host that ignores the .htaccess. --no-csp-header sends no policy header, as
// GitHub Pages does: the page then has only the <meta> policy that the build put into index.html.
// DIST_DIR serves another folder than dist/ (the update test serves a copy it changes).
// Usage: node scripts/serve-dist.mjs <port> <mount path, for example /~sfdraeger/ddalab/> [--no-csp-header]
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cspOf } from "./policy.mjs";

const dist = join(resolve(process.env.DIST_DIR ?? fileURLToPath(new URL("../dist/", import.meta.url))), "/");
const [port, mount, option] = process.argv.slice(2);
if (!port || !mount?.startsWith("/") || !mount.endsWith("/"))
  throw new Error("usage: serve-dist.mjs <port> </mount/>");
const csp = cspOf(readFileSync(join(dist, ".htaccess"), "utf8"));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": process.env.DIST_WASM_TYPE ?? "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  let file;
  let body;
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!path.startsWith(mount)) throw new Error("outside the mount path");
    file = resolve(dist, path.slice(mount.length) || "index.html");
    if (!file.startsWith(dist)) throw new Error("outside dist");
    body = readFileSync(file);
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    ...(option === "--no-csp-header" ? {} : { "content-security-policy": csp }),
  });
  response.end(body);
}).listen(Number(port), "127.0.0.1");
