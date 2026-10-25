// The production build on a plain static host: relative URLs under a path, no COOP/COEP headers, and whatever CSP
// the host sends. The build has no `__ddalab` hook, so the test drives the UI as a user does.
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url)),
);

test("opens_a_recording_and_runs_dda", async ({ page }) => {
  // A blocked script, worker, wasm or fetch shows up as a console error, a page error or a failed response.
  const problems: string[] = [];
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  page.on("pageerror", (error) => problems.push(error.message));
  page.on(
    "response",
    (response) => response.status() >= 400 && problems.push(`${response.status()} ${response.url()}`),
  );
  page.on("requestfailed", (request) => problems.push(`failed ${request.url()}`));

  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("./");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);

  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Playwright's WebKit has no OPFS, where results are written; Safari itself has.
  const hasStorage = await page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
  if (hasStorage) {
    const run = page.getByRole("region", { name: "Run" });
    await page.getByRole("checkbox", { name: "Select Fp1" }).check();
    await page.getByRole("checkbox", { name: "Select Fp2" }).check();
    await run.getByLabel("Start", { exact: true }).fill("1");
    await run.getByLabel("End", { exact: true }).fill("5");
    await run.getByLabel("End", { exact: true }).press("Enter");
    await run.getByRole("button", { name: "Run DDA" }).click();
    await expect(run.getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  }
  expect(problems).toEqual([]);
});
