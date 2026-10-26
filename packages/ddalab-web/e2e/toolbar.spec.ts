// The command bar holds still while the view zooms: wheel zooming across the whole range moves no element of the bar,
// at 1024, 1280 and 1600 px, with the inspector open and with it closed (the run status then shows in the bar). At
// every width from 768 px every control stays inside the window.
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
// labels give way to their marks; nothing falls past the window's edge.
test("bar_fits_the_window", async ({ page }) => {
  await openDay(page);
  for await (const layout of layouts(page, [768, 1024, 1280, 1600])) {
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
    plural(Math.max(1, cores - 1), "analysis worker"),
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
    await expect(note.getByRole("paragraph")).toHaveText([
      "Recordings are read directly in your browser. Nothing is uploaded, and the site keeps no copy of your data or results.",
      "Every analysis runs on this device. How long a recording or an analysis can be depends on the device's memory and processor.",
      `This device: ${device}.`,
      "OpenNeuro recordings stream from OpenNeuro to this device.",
    ]);
    await page.keyboard.press("Escape");
    await expect(note).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});
