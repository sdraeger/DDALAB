import { defineConfig, devices } from "@playwright/test";

// The built app (dist/, from `npm run build`) on a static host, once per browser and per host kind:
// - chromium, firefox, webkit: under a userdir path (/~sfdraeger/ddalab/), with the Content-Security-Policy header of
//   dist/.htaccess as Apache sends it, besides the <meta> policy of index.html.
// - pages-chromium, pages-firefox, pages-webkit: under /DDALAB/ with no policy header, as Pages serves a project site.
//   Only the <meta> policy of index.html governs the page.
// DIST_WASM_TYPE=application/octet-stream serves the wasm module without its MIME type, as a host that ignores the
// .htaccess does. DDALAB_E2E_PORT (5175 by default) is the port of the userdir server; the Pages one takes the next.
// DIST_URL runs the same tests, without the pages-* projects, against another host: an Apache with public/.htaccess,
// or the deployed Pages site.
const port = Number(process.env.DDALAB_E2E_PORT ?? 5175);
const userdir = process.env.DIST_URL ?? `http://127.0.0.1:${port}/~sfdraeger/ddalab/`;
const pages = `http://127.0.0.1:${port + 1}/DDALAB/`;
const browsers = {
  chromium: devices["Desktop Chrome"],
  firefox: devices["Desktop Firefox"],
  webkit: devices["Desktop Safari"],
};

export default defineConfig({
  testDir: "e2e-dist",
  webServer: process.env.DIST_URL
    ? undefined
    : [
        { command: `node scripts/serve-dist.mjs ${port} /~sfdraeger/ddalab/`, url: userdir },
        { command: `node scripts/serve-dist.mjs ${port + 1} /DDALAB/ --no-csp-header`, url: pages },
      ].map((server) => ({ ...server, reuseExistingServer: false })),
  projects: Object.entries(browsers).flatMap(([name, device]) => [
    { name, use: { ...device, baseURL: userdir } },
    ...(process.env.DIST_URL ? [] : [{ name: `pages-${name}`, use: { ...device, baseURL: pages } }]),
  ]),
});
