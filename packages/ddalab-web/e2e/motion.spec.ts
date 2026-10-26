// The motion system (src/styles/tokens.css): every transition in the app runs on one duration and one curve, none
// transitions `all`, popups grow out of their trigger and, under reduced motion, appear without scaling. The theme
// switch crossfades on the same tokens.
import type { Locator } from "@playwright/test";
import { expect, type Page, test } from "./test";

const DURATION = "0.16s";
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

const openRecording = (page: Page) =>
  page.evaluate(() => window.__ddalab.openSynthetic({ channels: 2, rateHz: 256, durationS: 60, seed: 1 }));

const timing = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, ease: style.transitionTimingFunction };
  });

/** Every element that transitions anything, with what it transitions, how long and on which curve. */
const transitioning = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("*")].flatMap((element) => {
      const style = getComputedStyle(element);
      const durations = style.transitionDuration.split(", ");
      if (durations.every((d) => Number.parseFloat(d) === 0)) return [];
      const name = `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`;
      return [{ name, property: style.transitionProperty, durations, ease: style.transitionTimingFunction }];
    }),
  );

/** Every transition on the page uses the tokens, and none transitions `all`. */
async function expectOnlyTokens(page: Page) {
  const found = await transitioning(page);
  expect(found.length).toBeGreaterThan(10);
  for (const { name, property, durations, ease } of found) {
    expect(property.split(", "), name).not.toContain("all");
    expect(new Set(durations), name).toEqual(new Set([DURATION]));
    expect(ease.replaceAll(EASE, "").replace(/[,\s]/g, ""), name).toBe("");
  }
}

/** The horizontal scale of `selector`'s element on each animation frame while `act` runs and 300 ms after. */
async function scalesDuring(page: Page, selector: string, act: () => Promise<void>) {
  await page.evaluate((s) => {
    const scales: number[] = [];
    const sample = () => {
      const element = document.querySelector(s);
      if (element) {
        const transform = getComputedStyle(element).transform;
        scales.push(transform === "none" ? 1 : new DOMMatrix(transform).a);
      }
      Object.assign(window, { raf: requestAnimationFrame(sample) });
    };
    Object.assign(window, { scales });
    sample();
  }, selector);
  await act();
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const w = window as unknown as { raf: number; scales: number[] };
    cancelAnimationFrame(w.raf);
    return w.scales;
  });
}

test("transitions_use_the_tokens", async ({ page }) => {
  const root = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue("--motion-duration"), style.getPropertyValue("--motion-ease")];
  });
  expect(root).toEqual(["160ms", EASE]);
  await openRecording(page);
  const tokens = { duration: DURATION, ease: EASE };
  // A button and the panels.
  expect(await timing(page.getByRole("button", { name: "Open files" }))).toEqual(tokens);
  expect(await timing(page.getByRole("complementary", { name: "Library" }))).toEqual(tokens);
  expect(await timing(page.getByRole("region", { name: "Inspector" }))).toEqual(tokens);
  expect(await timing(page.getByRole("region", { name: "Waveforms" }))).toEqual(tokens);
  await expectOnlyTokens(page);
  // A Select popup.
  await page.getByRole("combobox", { name: "Epoch" }).click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  // Base UI holds a popup's transitions off for its first frame.
  await expect.poll(() => timing(listbox.locator(".."))).toEqual(tokens);
  await expectOnlyTokens(page);
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  // A dialog: the popover of the local-data note.
  await page.getByRole("button", { name: "Data stays on this device" }).click();
  const dialog = page.getByRole("dialog", { name: "Everything stays on this device" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => timing(dialog)).toEqual(tokens);
  await expectOnlyTokens(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // A tooltip.
  await page.getByRole("button", { name: "Library" }).hover();
  const tooltip = page.locator("[data-base-ui-portal] div:not([role])", { hasText: /^Library$/ });
  await expect(tooltip).toBeVisible();
  await expect.poll(() => timing(tooltip)).toEqual(tokens);
});

test("popups_grow_from_their_trigger", async ({ page }) => {
  await openRecording(page);
  const scales = await scalesDuring(page, '[role="dialog"]', () =>
    page.getByRole("button", { name: "Data stays on this device" }).click(),
  );
  expect(Math.min(...scales)).toBeLessThan(0.999);
  expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.97);
  expect(scales.at(-1)).toBe(1);
});

test("reduced_motion_popups_do_not_scale", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRecording(page);
  const select = await scalesDuring(page, '[role="listbox"]', () =>
    page.getByRole("combobox", { name: "Epoch" }).click(),
  );
  await page.keyboard.press("Escape");
  const dialog = await scalesDuring(page, '[role="dialog"]', () =>
    page.getByRole("button", { name: "Data stays on this device" }).click(),
  );
  for (const scales of [select, dialog]) {
    expect(scales.length).toBeGreaterThan(3);
    expect(new Set(scales)).toEqual(new Set([1]));
  }
  // The fade stays.
  await expect.poll(() => timing(page.getByRole("dialog"))).toEqual({ duration: DURATION, ease: EASE });
});

test("theme_switch_crossfades_on_the_tokens", async ({ page }) => {
  test.skip(!(await page.evaluate(() => "startViewTransition" in document)), "no view transitions here");
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    Object.assign(window, { crossfades: [] as string[][] });
    document.startViewTransition = (update) => {
      const transition = start(update);
      void transition.ready.then(() => {
        const style = getComputedStyle(document.documentElement, "::view-transition-new(root)");
        (window as unknown as { crossfades: string[][] }).crossfades.push([
          style.animationDuration,
          style.animationTimingFunction,
        ]);
      });
      return transition;
    };
  });
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .not.toBe(before);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { crossfades: string[][] }).crossfades))
    .toEqual([[DURATION, EASE]]);
});
