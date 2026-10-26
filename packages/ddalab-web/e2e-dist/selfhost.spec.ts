// The production build on a static host: relative URLs under a path, no COOP/COEP headers, and the CSP of
// public/.htaccess. The build has no `__ddalab` hook; the test drives the UI as a user does.
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url)),
);

test("opens_a_recording_and_runs_dda", async ({ page }) => {
  // A blocked script, worker, wasm, style or fetch shows up as a policy violation, a console error, a page error or a
  // failed response.
  const problems: string[] = [];
  const wasmTypes = new Set<string | undefined>();
  await page.exposeFunction("reportViolation", (text: string) => problems.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      (window as unknown as { reportViolation(text: string): void }).reportViolation(
        `CSP ${event.violatedDirective} blocked ${event.blockedURI}`,
      ),
    );
    Reflect.deleteProperty(window, "showOpenFilePicker");
  });
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
    if (response.url().endsWith(".wasm")) wasmTypes.add(response.headers()["content-type"]);
  });
  page.on("requestfailed", (request) => problems.push(`failed ${request.url()}`));

  await page.goto("./");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);

  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Base UI adds an inline <style> to an opened Select unless the app turns that off; style-src 'self' blocks it. Below
  // 1400 px the scale settings sit behind their button.
  const scales = page.getByRole("button", { name: "Epoch, sensitivity and timebase" });
  if (await scales.isVisible()) await scales.click();
  await page.getByRole("combobox", { name: "Epoch" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);

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
  // The server must have sent the wasm type the run asked for, or a fallback run would test nothing.
  if (!process.env.DIST_URL)
    expect([...wasmTypes]).toEqual([process.env.DIST_WASM_TYPE ?? "application/wasm"]);
});

// A deep link preconnects to OpenNeuro and S3 from the entry, which the policy's connect-src allows. The API answers
// an empty snapshot here and the link fails to resolve, in the panel; the preconnects themselves do reach both hosts.
test("deep_link_preconnects_within_the_policy", async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      (window as unknown as { reportViolation(text: string): void }).reportViolation(
        `CSP ${event.violatedDirective} blocked ${event.blockedURI}`,
      ),
    );
  });
  await page.route("https://openneuro.org/**", (route) =>
    route.fulfill({
      json: { data: { snapshot: { files: [] } } },
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" },
    }),
  );
  await page.goto("./?openneuro=ds003029&tag=1.0.7&file=sub-pt01/ieeg/run.vhdr");
  for (const host of ["https://openneuro.org", "https://s3.amazonaws.com"]) {
    await expect(page.locator(`link[rel="preconnect"][href="${host}"]`)).toHaveCount(1);
  }
  await expect(page.getByText("ds003029 1.0.7 has no folder sub-pt01")).toBeVisible();
  expect(violations).toEqual([]);
});
