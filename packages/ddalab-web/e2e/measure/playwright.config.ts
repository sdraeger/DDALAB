// The measurement harness of the React best-practice fixes (render counts and timings), Chromium, one worker. Each
// `*.measure.ts` asserts little and appends what it measures to $OUT as JSON lines, tagged with $LABEL.
//
//   OUT=<file.jsonl> LABEL=<commit> npx playwright test -c e2e/measure/playwright.config.ts renders.measure.ts
//   OUT=... LABEL=... MEASURE_DIST=<dir> [COLD=1] npx playwright test -c e2e/measure/playwright.config.ts timing.measure.ts
//
// renders.measure.ts needs the dev server (component names unminified) of the tree at $MEASURE_ROOT, this package by
// default. timing.measure.ts needs a build of that tree in e2e mode (`npx vite build --mode e2e --outDir <dir>`), served
// statically with the CSP of its .htaccess (serve.mjs). Port 5307 either way.
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

for (const key of ["OUT", "LABEL"]) if (!process.env[key]) throw new Error(`set ${key}`);
const dist = process.env.MEASURE_DIST;
const root = process.env.MEASURE_ROOT ?? fileURLToPath(new URL("../..", import.meta.url));
const origin = dist ? "http://127.0.0.1:5307" : "http://localhost:5307";

export default defineConfig({
  testDir: ".",
  testMatch: /\.measure\.ts$/,
  workers: 1,
  timeout: 600_000,
  use: { baseURL: origin },
  webServer: {
    command: dist ? `node serve.mjs 5307 ${dist}` : "npx vite --port 5307 --strictPort",
    cwd: dist ? fileURLToPath(new URL(".", import.meta.url)) : root,
    url: `${origin}/`,
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
});
