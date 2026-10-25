import { defineConfig, devices } from "@playwright/test";

// The built app (dist/, from `npm run build`) on a static host: under a userdir path, with the Content-Security-Policy
// of dist/.htaccess and no other special header. DIST_WASM_TYPE=application/octet-stream serves the wasm module
// without its MIME type, as a host that ignores the .htaccess does. DIST_URL runs the same tests against another
// host, such as an Apache with public/.htaccess.
const url = process.env.DIST_URL ?? "http://127.0.0.1:5175/~sfdraeger/ddalab/";

export default defineConfig({
  testDir: "e2e-dist",
  use: { baseURL: url },
  webServer: process.env.DIST_URL
    ? undefined
    : {
        command: "node scripts/serve-dist.mjs 5175 /~sfdraeger/ddalab/",
        url,
        reuseExistingServer: false,
      },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"] },
  ],
});
