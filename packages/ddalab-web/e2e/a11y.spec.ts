// Accessibility of the app's states as axe sees them (WCAG 2.2 A and AA, and axe's best practices), in both themes:
// empty with the About dialog, a recording open, a run in progress, and a result with the history, its provenance and
// the export panel.
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, hasStorage, hasWebGL2, NO_STORAGE, NO_WEBGL2, type Page, scanned, test } from "./test";

const BRAINVISION = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url)),
);
/** Eight channels for two hours with 4,000-sample windows every 10 samples: a run of many seconds. */
const LONG = { channels: 8, rateHz: 256, durationS: 2 * 3600, seed: 5 };

const runBar = (page: Page) => page.getByRole("region", { name: "Run" });
const settings = (page: Page) => page.getByRole("region", { name: "DDA settings" });

const THEMES = ["light", "dark"] as const;

/** Switches the theme and waits for the colors that transition to it to arrive. */
async function theme(page: Page, colorScheme: (typeof THEMES)[number]) {
  await page.emulateMedia({ colorScheme });
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => "replaced"))),
  );
}

/**
 * WCAG contrast of each element's text over what is behind it, and the ratio it needs (3 for large text, 4.5 else, 0
 * when disabled). Behind it are its own and its ancestors' backgrounds down to the first opaque one: a canvas counts
 * as clear, its background color showing where it draws nothing. With a canvas selector, `box` is the contrast of
 * the element's own background against that canvas's background color (3 needed, WCAG 1.4.11).
 */
const contrasts = (page: Page, targets: { selector: string; canvas?: string }[]) =>
  page.evaluate((targets) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2D canvas");
    type Rgba = number[];
    /** Any CSS color as sRGB bytes and alpha, as a canvas draws it. */
    const rgba = (css: string): Rgba => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => [
      ...[0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])),
      1,
    ];
    const behind = (element: Element) => {
      const layers: Rgba[] = [];
      for (let at: Element | null = element; at; at = at.parentElement) {
        layers.push(rgba(getComputedStyle(at).backgroundColor));
        if (layers[layers.length - 1][3] === 1) break;
      }
      return layers.reduceRight((below, layer) => over(layer, below), [255, 255, 255, 1]);
    };
    const luminance = (c: Rgba) => {
      const [r, g, b] = c
        .slice(0, 3)
        .map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    return targets.map(({ selector, canvas }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`nothing matches ${selector}`);
      const style = getComputedStyle(element);
      let opacity = 1;
      for (let at: Element | null = element; at; at = at.parentElement)
        opacity *= Number(getComputedStyle(at).opacity);
      const fg = rgba(style.color);
      const bg = behind(element);
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const disabled = element.closest(":disabled, [aria-disabled='true']") !== null;
      const canvasElement = canvas ? document.querySelector(canvas) : null;
      return {
        selector,
        text: ratio(over([fg[0], fg[1], fg[2], fg[3] * opacity], bg), bg),
        needs: disabled ? 0 : large ? 3 : 4.5,
        box: canvasElement ? ratio(bg, behind(canvasElement)) : null,
      };
    });
  }, targets);

/**
 * What axe finds on the page in the light and the dark theme, a line each: its violations, and the checks it left
 * incomplete that this spec cannot clear. Text contrast axe could not decide (text over a canvas, partly covered by
 * another element) is measured by `contrasts`. Base UI's focus guards are tabbable on purpose: they pass focus on into
 * or out of a popup. An `aria-controls` axe could not resolve is cleared when every id it names is on the page.
 */
async function problems(page: Page) {
  const found: string[] = [];
  for (const colorScheme of THEMES) {
    await theme(page, colorScheme);
    const { violations, incomplete } = await new AxeBuilder({ page }).analyze();
    for (const v of violations) {
      const nodes = v.nodes.map((n) => n.target.join(" ")).join(", ");
      found.push(`${colorScheme}: ${v.id} (${v.impact}): ${v.help}; ${nodes}`);
    }
    const unclear = incomplete.flatMap((v) =>
      v.nodes.map((n) => ({ id: v.id, selector: String(n.target[0]), html: n.html })),
    );
    const measured = await contrasts(
      page,
      unclear.filter((u) => u.id === "color-contrast").map(({ selector }) => ({ selector })),
    );
    for (const m of measured) {
      if (m.text < m.needs)
        found.push(`${colorScheme}: contrast ${m.text.toFixed(2)} below ${m.needs}; ${m.selector}`);
    }
    for (const { id, selector, html } of unclear) {
      if (id === "color-contrast") continue;
      if (id === "aria-hidden-focus" && html.includes("data-base-ui-focus-guard")) continue;
      const controlled =
        id === "aria-valid-attr-value" &&
        (await page.evaluate((selector) => {
          const ids = document.querySelector(selector)?.getAttribute("aria-controls")?.split(/\s+/) ?? [];
          return ids.length > 0 && ids.every((name) => document.getElementById(name));
        }, selector));
      if (!controlled) found.push(`${colorScheme}: ${id} left incomplete; ${selector}`);
    }
    test.info().annotations.push({
      type: "axe incomplete",
      description: `${colorScheme}: ${unclear.length} cleared (${measured.length} contrasts measured)`,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  return found;
}

async function openBrainVision(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(BRAINVISION);
  await expect(page.getByRole("heading", { name: "fixture.vhdr" })).toBeVisible();
  await expect(scanned(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await page.goto("/");
  await expect(page.getByRole("status").first()).toHaveText(/^\d+\.\d+\.\d+/);
});

test("empty_state", async ({ page }) => {
  await expect(page.getByText("Open a recording from the library")).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await page.getByRole("button", { name: "About DDALAB" }).click();
  await expect(page.getByRole("dialog", { name: "About DDALAB" })).toContainText("Fabio Crameri");
  expect(await problems(page)).toEqual([]);
});

test("about_by_keyboard", async ({ page }) => {
  const tab = test.info().project.name === "webkit" ? "Alt+Tab" : "Tab";
  const about = page.getByRole("banner").getByRole("button", { name: "About DDALAB" });
  // The About button follows the theme toggle in the command bar.
  await page.getByRole("banner").getByRole("button", { name: "Dark theme" }).focus();
  await page.keyboard.press(tab);
  await expect(about).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "About DDALAB" });
  await expect(dialog).toContainText("Fabio Crameri");
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(about).toBeFocused();
});

test("open_state", async ({ page }) => {
  await openBrainVision(page);
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await expect(runBar(page).getByText(/^Plan /)).toBeVisible();
  // The bar's Run joins once the engine has listed its variants, which can come after the plan, and fades in: axe
  // reads its contrast once it is there (problems waits for the fade).
  await expect(page.getByRole("banner").getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  expect(await problems(page)).toEqual([]);
});

test("running_state", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  // Four DDA workers whatever the machine: the run stays long and leaves cores to the other tests.
  await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 5 }));
  await page.reload();
  await page.evaluate((spec) => window.__ddalab.openSynthetic(spec), LONG);
  await page.getByRole("checkbox", { name: "Select group CH" }).check();
  await settings(page).getByLabel("Window", { exact: true }).fill("4000");
  await settings(page).getByLabel("Step", { exact: true }).fill("10");
  await runBar(page).getByLabel("Start", { exact: true }).fill("0");
  await runBar(page).getByLabel("End", { exact: true }).fill(String(LONG.durationS));
  await runBar(page).getByLabel("End", { exact: true }).press("Enter");
  await expect(runBar(page).getByText(/^Plan /)).toBeVisible();
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByRole("button", { name: "Cancel run" })).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await runBar(page).getByRole("button", { name: "Cancel run" }).click();
  await expect(runBar(page).getByText("Canceled", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("result_state", async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!(await hasStorage(page)), NO_STORAGE);
  test.skip(!(await hasWebGL2(page)), NO_WEBGL2);
  await openBrainVision(page);
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  await page.getByRole("checkbox", { name: "Select Fp2" }).check();
  await runBar(page).getByLabel("Start", { exact: true }).fill("1");
  await runBar(page).getByLabel("End", { exact: true }).fill("5");
  await runBar(page).getByLabel("End", { exact: true }).press("Enter");
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  // The heatmap, its row plot and the history.
  const result = page.getByRole("region", { name: "Result" });
  await expect(result).toBeVisible();
  await page.evaluate(() => window.__ddalab.results.settled());
  await result.getByRole("button", { name: "Fp2", exact: true }).click();
  await expect(result.getByRole("img", { name: "Line plot of Fp2" })).toBeVisible();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  expect(await problems(page)).toEqual([]);
  // The text over the canvases, which axe cannot measure: the overview's range tab and the heatmap's readout, shown
  // with the pointer on the heatmap.
  const heatmap = await page.locator("canvas[data-heatmap]").boundingBox();
  if (!heatmap) throw new Error("no heatmap canvas");
  await page.mouse.move(heatmap.x + heatmap.width / 2, heatmap.y + heatmap.height / 4);
  await expect(result.getByRole("tooltip")).toBeVisible();
  const strip = '[role="img"][aria-label^="The whole recording"]';
  for (const colorScheme of THEMES) {
    await theme(page, colorScheme);
    const measured = await contrasts(page, [
      { selector: `${strip} span`, canvas: `${strip} canvas` },
      { selector: 'section[aria-label="Result"] [role="tooltip"]', canvas: "canvas[data-heatmap]" },
    ]);
    for (const { selector, text, box } of measured) {
      expect(text, `${colorScheme}: text of ${selector}`).toBeGreaterThanOrEqual(4.5);
      expect(box, `${colorScheme}: box of ${selector} on its canvas`).toBeGreaterThanOrEqual(3);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.mouse.move(0, 0);
  // The provenance the history row opens, then its export panel.
  await history.getByRole("listitem").getByRole("button").click();
  const provenance = page.getByRole("region", { name: "Provenance" });
  await expect(provenance).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await provenance.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog", { name: "Export result" })).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await provenance.getByRole("button", { name: "Delete" }).click();
  await expect(provenance.getByText("Delete this result and its files?")).toBeVisible();
  expect(await problems(page)).toEqual([]);
});
