import { defineConfig, devices } from "@playwright/test";

// The built app (dist/, from `npm run build`) as a plain static host serves it: under a userdir path, by a server
// that sends no special headers. DIST_URL runs the same tests against another host, such as an Apache with
// public/.htaccess.
const url = process.env.DIST_URL ?? "http://localhost:5175/~sfdraeger/ddalab/";

export default defineConfig({
  testDir: "e2e-dist",
  use: { baseURL: url },
  webServer: process.env.DIST_URL
    ? undefined
    : {
        // .selfhost/~sfdraeger/ddalab is a link to dist, so the server mounts the app at a path, not at the root.
        command:
          "mkdir -p .selfhost/~sfdraeger && ln -sfn ../../dist .selfhost/~sfdraeger/ddalab && python3 -m http.server 5175 --directory .selfhost",
        url,
        reuseExistingServer: false,
      },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"] },
  ],
});
