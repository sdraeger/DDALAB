// Takes the web manifest's screenshots, which install sheets and store listings show: the app in light mode on the
// BrainVision fixture with four channels' ST result, at 1280x800 (public/screenshots/wide.png) and the phone layout's
// waveform view at 390x844 (public/screenshots/narrow.png).
// Usage: npm run build:wasm && node scripts/make-screenshots.mjs
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const FIXTURES = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) =>
  here(`../../dda-rs/tests/fixtures/${name}`),
);
const PORT = 5199;

const server = await createServer({
  configFile: here("../vite.config.ts"),
  server: { port: PORT, strictPort: true },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByLabel("Recording files").setInputFiles(FIXTURES);
  await page.getByRole("heading", { name: "fixture.vhdr" }).waitFor();
  for (const channel of ["Fp1", "Fp2", "Cz", "Pz"]) {
    await page.getByRole("checkbox", { name: `Select ${channel}` }).check();
  }
  const run = page.getByRole("region", { name: "Run" });
  await run.getByRole("button", { name: "Run DDA" }).click();
  await run.getByText("Complete", { exact: true }).waitFor({ timeout: 60_000 });
  // The result's heatmap and line plot paint after the run's last block.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: here("../public/screenshots/wide.png") });
  // Below 768 px the phone layout shows one view at a time.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Waveform" }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: here("../public/screenshots/narrow.png") });
} finally {
  await browser.close();
  await server.close();
}
