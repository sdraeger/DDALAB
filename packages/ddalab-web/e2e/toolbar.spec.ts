// The command bar holds still while the view zooms: wheel zooming across the whole range moves no element of the bar,
// with the inspector open and with it closed (the run status then shows in the bar).
import { expect, type Page, test } from "./test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

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
 * Twenty steps of a factor 2.2 cover the day's whole range (2.8 million) each way.
 */
async function zoomAcross(page: Page) {
  const box = await page.locator("canvas[data-traces]").boundingBox();
  if (!box) throw new Error("no waveform");
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  for (const dy of [-400, 400, -400]) {
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, dy);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    // At rest the run interval settles and the bar's run status may change (why the shortest span cannot run).
    await page.waitForTimeout(500);
  }
}

test("bar_holds_still_while_zooming", async ({ page }) => {
  test.setTimeout(90_000); // 120 wheel steps a frame apart, on a busy machine
  await page.setViewportSize({ width: 1600, height: 900 });
  // A day at 256 Hz: the timebase runs from thousandths of a mm/s to thousands, the page from 1 to 8640.
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 2, rateHz: 256, durationS: 86_400, seed: 5 }),
  );
  // Run joins the bar once the engine has listed its variants.
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  for (const inspector of ["open", "closed"]) {
    if (inspector === "closed") await page.getByRole("button", { name: "Inspector" }).click();
    // Past the panels' fade-in: only the zoom moves anything from here on.
    await page.waitForTimeout(400);
    const { frames, labels } = await edgesDuring(page, () => zoomAcross(page));
    expect(frames.length).toBeGreaterThan(60);
    const moved = labels.flatMap((label, i) => {
      const spread = (k: number) =>
        Math.max(...frames.map((f) => f[k])) - Math.min(...frames.map((f) => f[k]));
      const [left, right] = [spread(2 * i), spread(2 * i + 1)];
      return left > 0.5 || right > 0.5
        ? [`${label}: left ${left.toFixed(1)} px, right ${right.toFixed(1)} px`]
        : [];
    });
    expect(moved, `inspector ${inspector}`).toEqual([]);
  }
});

// The note beside the theme toggle opens by pointer and by keyboard, says what stays local and what this device has,
// and closes with Escape, giving focus back to its trigger.
test("local_note_opens_and_closes", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Data stays on this device" });
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
      "Every analysis runs on this computer. How long a recording or an analysis can be depends on its memory and processor.",
      `This device: ${device}.`,
      "OpenNeuro recordings stream from OpenNeuro to this device.",
    ]);
    await page.keyboard.press("Escape");
    await expect(note).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});
