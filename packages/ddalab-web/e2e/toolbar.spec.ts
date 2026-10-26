// The command bar holds still while the view zooms: wheel zooming across the whole range moves no element of the bar,
// at 1024, 1280 and 1600 px, with the inspector open and with it closed (the run status then shows in the bar). At
// every width from 768 px every control stays inside the window, and the scale settings behind their button work.
import { fileURLToPath } from "node:url";
import { ddaPoolSize } from "../src/core/engine";
import { expect, type Page, test } from "./test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

/** A day at 256 Hz: the timebase runs from thousandths of a mm/s to thousands, the page from 1 to 8640. */
async function openDay(page: Page) {
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 2, rateHz: 256, durationS: 86_400, seed: 5 }),
  );
  // Run joins the bar once the engine has listed its variants.
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
}

/** Each width with the inspector open, then each with it closed. */
async function* layouts(page: Page, widths: number[]) {
  for (const inspector of ["open", "closed"]) {
    if (inspector === "closed") await page.getByRole("button", { name: "Inspector" }).click();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      // Past the inspector's crossfade: only what follows moves anything.
      await page.waitForTimeout(400);
      yield `${width} px, inspector ${inspector}`;
    }
  }
}

/** The left and right edges of every element in the bar, per animation frame, while `act` runs. */
async function edgesDuring(page: Page, act: () => Promise<void>) {
  await page.evaluate(() => {
    const frames: number[][] = [];
    const elements = [...(document.querySelector("header")?.querySelectorAll("*") ?? [])];
    const sample = () => {
      frames.push(
        elements.flatMap((e) => {
          const box = e.getBoundingClientRect();
          return [box.left, box.right];
        }),
      );
      Object.assign(window, { raf: requestAnimationFrame(sample) });
    };
    Object.assign(window, { frames, labels: elements.map((e) => e.outerHTML.slice(0, 80)) });
    sample();
  });
  await act();
  return page.evaluate(() => {
    const w = window as unknown as { raf: number; frames: number[][]; labels: string[] };
    cancelAnimationFrame(w.raf);
    return { frames: w.frames, labels: w.labels };
  });
}

/**
 * Wheel steps over the waveform, each a frame apart: in to the shortest span, out to the whole recording, in again.
 * Thirteen steps of a factor 3.3 cover the day's whole range (2.8 million) each way.
 */
async function zoomAcross(page: Page) {
  const box = await page.locator("canvas[data-traces]").boundingBox();
  if (!box) throw new Error("no waveform");
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  for (const dy of [-600, 600, -600]) {
    for (let i = 0; i < 13; i++) {
      await page.mouse.wheel(0, dy);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    // At rest the run interval settles and the bar's run status may change (why the shortest span cannot run).
    await page.waitForTimeout(500);
  }
}

test("bar_holds_still_while_zooming", async ({ page }) => {
  test.setTimeout(150_000); // 234 wheel steps a frame apart, on a busy machine
  await openDay(page);
  for await (const layout of layouts(page, [1024, 1280, 1600])) {
    const { frames, labels } = await edgesDuring(page, () => zoomAcross(page));
    expect(frames.length).toBeGreaterThan(39);
    const moved = labels.flatMap((label, i) => {
      const spread = (k: number) =>
        Math.max(...frames.map((f) => f[k])) - Math.min(...frames.map((f) => f[k]));
      const [left, right] = [spread(2 * i), spread(2 * i + 1)];
      return left > 0.5 || right > 0.5
        ? [`${label}: left ${left.toFixed(1)} px, right ${right.toFixed(1)} px`]
        : [];
    });
    expect(moved, layout).toEqual([]);
  }
});

// Where the bar is short the scale settings move behind one button, then the wordmark and the Local and Annotate
// labels give way to their marks; nothing falls past the window's edge. The widths include both sides of 1400 px,
// where the settings move with the inspector open. The run status keeps clamp(120px, 18vw, 280px) while the bar has
// room to spare, and gives way, alone, where it has none.
test("bar_fits_the_window", async ({ page }) => {
  test.setTimeout(60_000);
  await openDay(page);
  for await (const layout of layouts(page, [768, 1024, 1280, 1390, 1399, 1400, 1600])) {
    const slot = await page.evaluate(() => {
      const bar = document.querySelector("header") as HTMLElement;
      const status = bar.querySelector("[aria-live]");
      const spare = [...bar.children]
        .filter((e) => e.className.includes("grow"))
        .reduce((sum, e) => sum + e.getBoundingClientRect().width, 0);
      const basis = Math.min(280, Math.max(120, 0.18 * innerWidth));
      return status && { width: status.getBoundingClientRect().width, spare, basis };
    });
    if (layout.endsWith("closed")) {
      expect(slot, layout).not.toBeNull();
      const { width, spare, basis } = slot as { width: number; spare: number; basis: number };
      if (spare > 0.5) expect(Math.abs(width - basis), layout).toBeLessThan(0.5);
      else expect(width, layout).toBeLessThanOrEqual(basis + 0.5);
    }
    const outside = await page.evaluate(() => {
      const bar = document.querySelector("header") as HTMLElement;
      const controls = [...bar.querySelectorAll("button, [role='combobox']")].filter((e) =>
        e.checkVisibility(),
      );
      const out = controls.filter((e) => {
        const box = e.getBoundingClientRect();
        return box.left < 0 || box.right > innerWidth;
      });
      return [
        ...out.map((e) => e.getAttribute("aria-label") ?? e.textContent),
        ...(bar.scrollWidth > bar.clientWidth
          ? [`the bar overflows by ${bar.scrollWidth - bar.clientWidth} px`]
          : []),
      ];
    });
    expect(outside, layout).toEqual([]);
    for (const name of ["Local: data stays on this device", "Annotate", "Dark theme", "Run"]) {
      await expect(page.getByRole("button", { name, exact: true }), layout).toBeInViewport({ ratio: 1 });
    }
    const scales = page.getByRole("button", { name: "Epoch, sensitivity and timebase" });
    const epoch = page.getByRole("combobox", { name: "Epoch" });
    expect((await epoch.isVisible()) !== (await scales.isVisible()), layout).toBe(true);
    if (await scales.isVisible()) {
      await scales.click();
      await expect(epoch).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(epoch).toBeHidden();
    }
  }
});

// Below 1400 px the scale settings sit in a popover: picking an option there keeps it open (the Select belongs to
// the popover), Escape closes it, and a resize that moves the settings back into the bar closes it too.
test("scale_settings_behind_their_button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDay(page);
  const scales = page.getByRole("button", { name: "Epoch, sensitivity and timebase" });
  const popover = page.getByRole("dialog", { name: "Epoch, sensitivity and timebase" });
  await expect(scales).toHaveAttribute("aria-expanded", "false");
  await scales.click();
  await expect(popover).toBeVisible();
  await expect(scales).toHaveAttribute("aria-expanded", "true");
  await popover.getByRole("combobox", { name: "Epoch" }).click();
  await page.getByRole("option", { name: "20 s" }).click();
  await expect.poll(() => page.evaluate(() => window.__ddalab.store.getState().view.epochS)).toBe(20);
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("combobox", { name: "Epoch" })).toHaveText("20 s");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(scales).toHaveAttribute("aria-expanded", "false");
  await expect(scales).toBeFocused();
  await scales.click();
  await expect(popover).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(popover).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Epoch" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(scales).toHaveAttribute("aria-expanded", "false");
});

// The note beside the theme toggle opens by pointer and by keyboard, says what stays local and what this device has,
// and closes with Escape, giving focus back to its trigger.
test("local_note_opens_and_closes", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Local: data stays on this device" });
  const note = page.getByRole("dialog", { name: "Everything stays on this device" });
  const { cores, memory } = await page.evaluate(() => ({
    cores: navigator.hardwareConcurrency,
    memory: (navigator as { deviceMemory?: number }).deviceMemory,
  }));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const device = [
    plural(cores, "logical core"),
    `up to ${plural(ddaPoolSize(cores, 1), "analysis worker")}`,
    ...(memory ? [`at least ${memory} GB memory`] : []),
  ].join(", ");
  await expect(trigger).toHaveText("Local");
  const byPointer = () => trigger.click();
  const byKeyboard = async () => {
    await trigger.focus();
    await page.keyboard.press("Enter");
  };
  for (const open of [byPointer, byKeyboard]) {
    await open();
    await expect(note).toBeVisible();
    await expect(note.locator(":scope > p")).toHaveText([
      "Recordings are read directly in your browser. Nothing is uploaded, and the site keeps no copy of your data or results.",
      "Every analysis runs on this device. Its memory and processor set how large a recording and how long an analysis can be.",
      `This device: ${device}.`,
      "OpenNeuro recordings stream from OpenNeuro to this device.",
    ]);
    await page.keyboard.press("Escape");
    await expect(note).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  // Below 1024 px the mark stands alone; its tooltip says what it means.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(trigger.getByText("Local", { exact: true })).toBeHidden();
  await trigger.hover();
  await expect(page.getByText("Data stays on this device", { exact: true })).toBeVisible();
});

// The note's Storage section says what the site keeps and clears the cached tiles, except those of open recordings.
test("storage_clears_cached_tiles_but_an_open_recordings", async ({ page }) => {
  const tileFolders = () =>
    page.evaluate(async () => {
      try {
        const tiles = await (await navigator.storage.getDirectory()).getDirectoryHandle("tiles", {
          create: true,
        });
        const names: string[] = [];
        for await (const [name] of tiles.entries()) names.push(name);
        return names.length;
      } catch {
        return -1;
      }
    });
  test.skip((await tileFolders()) < 0, "this browser window has no OPFS");
  const edf = fileURLToPath(new URL("../../dda-rs/tests/fixtures/fixture.edf", import.meta.url));
  await page.getByLabel("Recording files").setInputFiles(edf);
  await expect.poll(tileFolders).toBe(1);
  const storage = page.getByRole("region", { name: "Storage" });
  const clear = storage.getByRole("button", { name: "Clear cached tiles" });
  await page.getByRole("button", { name: "Local: data stays on this device" }).click();
  await expect(storage).toContainText(
    /This site uses .+ of the .+ the browser allows it\. Cached tiles take \d+ kB\./,
  );
  await clear.click();
  await expect(storage).toContainText("Results stay, and so do the tiles of open recordings.");
  expect(await tileFolders()).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByTitle("Close fixture.edf").click();
  await page.getByRole("button", { name: "Local: data stays on this device" }).click();
  await clear.click();
  await expect(storage).toContainText("Cached tiles take 0 kB.");
  expect(await tileFolders()).toBe(0);
  await expect(clear).toBeDisabled();
});
