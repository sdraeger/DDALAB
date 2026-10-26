// Annotations a researcher makes: A and Enter at the pointer, a span over the selection, a double-click, label
// suggestions, Escape, a flag dragged along the ruler, the inspector list from the keyboard, a span as the run interval,
// a reload, and the events.tsv export.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "./test";

const EDF = fileURLToPath(new URL("../../dda-rs/tests/fixtures/fixture.edf", import.meta.url));

const editor = (page: Page) => page.getByRole("dialog");
const list = (page: Page) => page.getByRole("list", { name: "Annotations" });
const runBar = (page: Page) => page.getByRole("region", { name: "Run" });

/** Opens the EDF+ fixture: 30 s at 256 Hz, its own events "eyes closed" (2.5 s for 1 s) and "spike" (20 s). */
async function openFixture(page: Page) {
  await page.getByLabel("Recording files").setInputFiles(EDF);
  await expect(page.getByRole("list", { name: "Channels" }).getByRole("listitem")).toHaveCount(2);
  await expect(list(page).getByRole("button", { name: /^spike/ })).toBeVisible();
}

/** The user's annotations of the active recording, by onset: [onset, duration, label]. */
const mine = (page: Page) =>
  page.evaluate(() => {
    const s = window.__ddalab.store.getState();
    const fingerprint = s.recordings[s.activeRecordingId as string].fingerprint;
    return (s.annotations[fingerprint] ?? [])
      .map((a) => [a.onset_s, a.duration_s, a.label] as [number, number, string])
      .sort((a, b) => a[0] - b[0]);
  });

/** The annotations IndexedDB holds for the recording: [onset, duration, label]. */
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<[number, number, string][]>((resolve, reject) => {
        const opening = indexedDB.open("ddalab");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const all = db.transaction("annotations").objectStore("annotations").getAll();
          all.onsuccess = () => {
            db.close();
            const records = all.result as { onset_s: number; duration_s: number; label: string }[];
            resolve(
              records
                .map((a): [number, number, string] => [a.onset_s, a.duration_s, a.label])
                .sort((a, b) => a[0] - b[0]),
            );
          };
        };
      }),
  );

/** The page x of time `t` across `selector` (the plot's traces or the ruler), and a y inside it. */
async function at(page: Page, selector: string, t: number) {
  const box = await page.locator(selector).boundingBox();
  const { t0, t1 } = await page.evaluate(() => window.__ddalab.store.getState().view);
  if (!box) throw new Error(`${selector} is not on screen`);
  return { x: box.x + ((t - t0) / (t1 - t0)) * box.width, y: box.y + box.height / 2 };
}
const plotAt = (page: Page, t: number) => at(page, "canvas[data-traces]", t);
const rulerAt = (page: Page, t: number) => at(page, "canvas[data-ruler]", t);

/** One pixel of the plot in seconds: how close a time set with the pointer lands. */
async function pixelS(page: Page) {
  const box = await page.locator("canvas[data-traces]").boundingBox();
  const { t0, t1 } = await page.evaluate(() => window.__ddalab.store.getState().view);
  return (t1 - t0) / (box?.width ?? 1);
}

/** Shows the 10 s from `t0`. */
const showFrom = (page: Page, t0: number) =>
  page.evaluate(
    (t) => window.__ddalab.store.setState((s) => ({ view: { ...s.view, t0: t, t1: t + 10 } })),
    t0,
  );

/**
 * Double-clicks the plot at `t` (paging there first) and saves the editor with `label`; then sets the onset and the
 * duration exactly, from the list.
 */
async function mark(page: Page, t: number, label: string, exact?: { onset: string; duration: string }) {
  await showFrom(page, Math.floor(t / 10) * 10);
  const { x, y } = await plotAt(page, t);
  await page.mouse.dblclick(x, y);
  await expect(editor(page)).toBeVisible();
  await editor(page).getByLabel("Label").fill(label);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
  if (!exact) return;
  await list(page)
    .getByRole("button", { name: new RegExp(`^${label},`) })
    .focus();
  await page.keyboard.press("F2");
  await editor(page).getByLabel("Onset (s)").fill(exact.onset);
  await editor(page).getByLabel("Duration (s)").fill(exact.duration);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openFixture(page);
});

test("a_then_enter_marks_a_point_at_the_pointer", async ({ page }) => {
  const { x, y } = await plotAt(page, 5);
  await page.mouse.move(x, y);
  await page.keyboard.press("a");
  await expect(editor(page).getByRole("heading", { name: /New annotation/ })).toBeVisible();
  await expect(editor(page).getByLabel("Label")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
  const [[onset, duration]] = await mine(page);
  expect(Math.abs(onset - 5)).toBeLessThanOrEqual(await pixelS(page));
  expect(duration).toBe(0);
  await expect(list(page).getByRole("button", { name: /^event, .*, yours$/ })).toBeVisible();
});

test("a_selection_then_a_marks_a_span", async ({ page }) => {
  const from = await plotAt(page, 3);
  const to = await plotAt(page, 6);
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const selection = await page.evaluate(() => window.__ddalab.store.getState().selection);
  await page.getByRole("button", { name: "Annotate" }).click();
  await editor(page).getByLabel("Label").fill("seizure");
  await page.keyboard.press("Enter");
  expect(await mine(page)).toEqual([[selection?.t0, (selection?.t1 ?? 0) - (selection?.t0 ?? 0), "seizure"]]);
  await expect(list(page).getByRole("button", { name: "Use as selection: seizure" })).toBeVisible();
});

test("a_click_on_the_plot_then_annotate_marks_the_cursor", async ({ page }) => {
  const { x, y } = await plotAt(page, 7);
  await page.mouse.click(x, y);
  await page.getByRole("button", { name: "Annotate" }).click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
  const [[onset, duration]] = await mine(page);
  expect(Math.abs(onset - 7)).toBeLessThanOrEqual(await pixelS(page));
  expect(duration).toBe(0);
});

test("a_double_click_marks_a_point_and_a_press_elsewhere_keeps_its_label", async ({ page }) => {
  const { x, y } = await plotAt(page, 7);
  await page.mouse.dblclick(x, y);
  await editor(page).getByLabel("Label").fill("artifact");
  // The rest of the page is hidden from assistive technology while the editor is open: a press by position.
  await page.locator("h3", { hasText: "Annotations" }).click();
  await expect(editor(page)).toBeHidden();
  const [[onset, , label]] = await mine(page);
  expect(Math.abs(onset - 7)).toBeLessThanOrEqual(await pixelS(page));
  expect(label).toBe("artifact");
});

test("the_label_field_suggests_the_recordings_labels_and_keeps_the_last", async ({ page }) => {
  const four = await plotAt(page, 4);
  await page.mouse.move(four.x, four.y);
  await page.keyboard.press("a");
  await editor(page).getByLabel("Label").fill("ey");
  await page.getByRole("option", { name: "eyes closed" }).click();
  await expect(editor(page).getByLabel("Label")).toHaveValue("eyes closed");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
  expect((await mine(page))[0][2]).toBe("eyes closed");
  // The next annotation starts with the label saved last, selected: A, Enter marks another.
  const eight = await plotAt(page, 8);
  await page.mouse.move(eight.x, eight.y);
  await page.keyboard.press("a");
  await expect(editor(page).getByLabel("Label")).toHaveValue("eyes closed");
  await page.keyboard.press("Enter");
  expect((await mine(page)).map(([, , label]) => label)).toEqual(["eyes closed", "eyes closed"]);
});

// With no suggestions on screen the arrow keys land on nothing, the field says it is collapsed, and Enter saves.
test("arrow_down_then_enter_on_a_fresh_editor_saves", async ({ page }) => {
  await page.keyboard.press("a");
  const field = editor(page).getByLabel("Label", { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(field).not.toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
  expect(await mine(page)).toHaveLength(1);
});

// Typing offers the labels that hold the text, read out as a count; ArrowDown and Enter pick one, Enter again saves.
test("a_suggestion_picked_by_keyboard_sets_the_label", async ({ page }) => {
  await page.keyboard.press("a");
  const field = editor(page).getByLabel("Label", { exact: true });
  await field.fill("ey");
  const suggestions = editor(page).getByRole("listbox", { name: "Label suggestions" });
  await expect(suggestions.getByRole("option")).toHaveText(["eyes closed"]);
  await expect(field).toHaveAttribute("aria-expanded", "true");
  await expect(editor(page).getByRole("status")).toHaveText("1 suggestion");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("eyes closed");
  await expect(suggestions).toBeHidden();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeHidden();
  expect((await mine(page)).map(([, , label]) => label)).toEqual(["eyes closed"]);
});

test("escape_takes_a_new_annotation_back", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeHidden();
  expect(await mine(page)).toEqual([]);
  // Nothing is left to undo either.
  await page.keyboard.press("ControlOrMeta+z");
  expect(await mine(page)).toEqual([]);
});

test("a_flag_dragged_along_the_ruler_moves_and_undo_moves_it_back", async ({ page }) => {
  await mark(page, 5, "mark", { onset: "5", duration: "0" });
  const from = await rulerAt(page, 5);
  const to = await rulerAt(page, 8);
  await page.mouse.move(from.x + 3, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x + 3, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(editor(page)).toBeHidden();
  const [[onset]] = await mine(page);
  expect(Math.abs(onset - 8)).toBeLessThanOrEqual(await pixelS(page));
  await page.keyboard.press("ControlOrMeta+z");
  expect(await mine(page)).toEqual([[5, 0, "mark"]]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(Math.abs((await mine(page))[0][0] - 8)).toBeLessThanOrEqual(await pixelS(page));
  // A click on the flag opens its editor, once a frame has drawn the flag where redo put it.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.mouse.click(to.x + 3, to.y);
  await expect(editor(page).getByRole("heading", { name: /^Annotation/ })).toBeVisible();
  await expect(editor(page).getByLabel("Onset (s)")).toBeVisible();
});

test("a_span_edge_dragged_on_the_plot_resizes_it", async ({ page }) => {
  await mark(page, 4, "burst", { onset: "4", duration: "2" });
  const edge = await plotAt(page, 6);
  const to = await plotAt(page, 7);
  await page.mouse.move(edge.x + 2, edge.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const [[onset, duration]] = await mine(page);
  expect(onset).toBe(4);
  expect(Math.abs(duration - 3)).toBeLessThanOrEqual(await pixelS(page));
  // The view did not pan.
  expect((await page.evaluate(() => window.__ddalab.store.getState().view)).t0).toBe(0);
});

test("the_list_moves_jumps_renames_and_deletes_from_the_keyboard", async ({ page }) => {
  await mark(page, 4, "first", { onset: "4", duration: "0" });
  await mark(page, 25, "second", { onset: "25", duration: "0" });
  const rows = list(page).getByRole("button", { name: /, (yours|fixture\.edf)$/ });
  await expect(rows).toHaveCount(4);
  await showFrom(page, 0);
  // By time: eyes closed (2.5 s), first (4 s), spike (20 s), second (25 s).
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAccessibleName("first, 4 s, yours");
  await page.keyboard.press("End");
  await expect(rows.nth(3)).toBeFocused();
  await page.keyboard.press("Enter");
  const view = await page.evaluate(() => window.__ddalab.store.getState().view);
  expect((view.t0 + view.t1) / 2).toBeCloseTo(25, 6);
  await expect(rows.nth(3)).toHaveAttribute("aria-current", "true");
  await expect(rows.nth(3)).toHaveAttribute("aria-keyshortcuts", "Enter F2 Delete");
  await page.keyboard.press("F2");
  await editor(page).getByLabel("Label").fill("renamed");
  await page.keyboard.press("Enter");
  await expect(rows.nth(3)).toHaveAccessibleName("renamed, 25 s, yours");
  await expect(rows.nth(3)).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(rows).toHaveCount(3);
  expect(await mine(page)).toEqual([[4, 0, "first"]]);
  // A file event is read-only: Delete leaves it, F2 shows its file.
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Delete");
  await expect(rows).toHaveCount(3);
  await page.keyboard.press("F2");
  await expect(editor(page).getByText("fixture.edf")).toBeVisible();
  await page.keyboard.press("Escape");
  // The filter and the switch narrow the list.
  await page.getByLabel("Filter annotations by label").fill("fir");
  await expect(rows).toHaveCount(1);
  await page.getByLabel("Filter annotations by label").fill("");
  await page.getByLabel("Show file events").uncheck();
  await expect(rows).toHaveCount(1);
  // A double-click opens the editor, for a pointer.
  await rows.first().dblclick();
  await expect(editor(page).getByLabel("Onset (s)")).toHaveValue("4");
});

test("use_as_selection_sets_the_run_interval_a_run_takes", async ({ page }) => {
  await mark(page, 2, "segment", { onset: "2", duration: "4" });
  await list(page).getByRole("button", { name: "Use as selection: segment" }).click();
  await expect(runBar(page).getByLabel("Start", { exact: true })).toHaveValue("2");
  await expect(runBar(page).getByLabel("End", { exact: true })).toHaveValue("6");
  await page.getByRole("checkbox", { name: "Select Fp1" }).check();
  const settings = page.getByRole("region", { name: "DDA settings" });
  for (const variant of ["ST", "CT", "CD", "DE", "SY"]) {
    await settings.getByRole("checkbox", { name: variant, exact: true }).setChecked(variant === "ST");
  }
  await runBar(page).getByRole("button", { name: "Run DDA" }).click();
  await expect(runBar(page).getByText("Complete", { exact: true })).toBeVisible({ timeout: 60_000 });
  const range = await page.evaluate(() => window.__ddalab.store.getState().analyses[0].request.time_range);
  expect(range).toEqual({ start: 2 * 256, end: 6 * 256 });
});

test("two_windows_on_one_recording_keep_each_others_annotations", async ({ page }) => {
  const other = await page.context().newPage();
  await other.goto("/");
  await openFixture(other);
  await mark(page, 4, "alpha", { onset: "4", duration: "0" });
  await mark(other, 8, "beta", { onset: "8", duration: "0" });
  const both = [
    [4, 0, "alpha"],
    [8, 0, "beta"],
  ];
  await expect.poll(() => stored(page)).toEqual(both);
  // Each window reads the other's change: both show both.
  for (const p of [page, other]) await expect.poll(() => mine(p)).toEqual(both);
  // Each edits a different annotation at the same time: one renames alpha, the other deletes beta.
  const alpha = list(page).getByRole("button", { name: /^alpha,/ });
  await alpha.focus();
  await page.keyboard.press("F2");
  await editor(page).getByLabel("Label").fill("renamed");
  await list(other)
    .getByRole("button", { name: /^beta,/ })
    .focus();
  await Promise.all([page.keyboard.press("Enter"), other.keyboard.press("Delete")]);
  await expect.poll(() => stored(page)).toEqual([[4, 0, "renamed"]]);
  for (const p of [page, other]) await expect.poll(() => mine(p)).toEqual([[4, 0, "renamed"]]);
  await other.close();
});

test("annotations_survive_a_reload", async ({ page }) => {
  await mark(page, 9, "kept", { onset: "9", duration: "1.5" });
  // Stored before the reload: a write the page has not finished when it unloads is lost.
  await expect.poll(() => stored(page)).toEqual([[9, 1.5, "kept"]]);
  await page.reload();
  await openFixture(page);
  await expect(list(page).getByRole("button", { name: "kept, 9 to 10.5 s, yours" })).toBeVisible();
  expect(await mine(page)).toEqual([[9, 1.5, "kept"]]);
});

test("export_writes_the_listed_annotations_as_events_tsv_and_json", async ({ page }) => {
  await mark(page, 4, "burst", { onset: "4.25", duration: "1.5" });
  // With a filter on, the export says it writes part of the list.
  await page.getByLabel("Filter annotations by label").fill("bur");
  await page.getByRole("button", { name: "Export annotations" }).click();
  await expect(page.getByRole("dialog").getByText("Export 1 of 3 annotations")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Filter annotations by label").fill("");
  await page.getByRole("button", { name: "Export annotations" }).click();
  await expect(page.getByRole("dialog").getByText("Export 3 annotations")).toBeVisible();
  const tsv = page.waitForEvent("download");
  await page.getByRole("button", { name: /BIDS events\.tsv/ }).click();
  const tsvFile = await tsv;
  expect(tsvFile.suggestedFilename()).toBe("fixture_events.tsv");
  expect(readFileSync(await tsvFile.path(), "utf8")).toBe(
    "onset\tduration\ttrial_type\n2.5\t1\teyes closed\n4.25\t1.5\tburst\n20\t0\tspike\n",
  );
  const json = page.waitForEvent("download");
  await page.getByRole("button", { name: /^JSON/ }).click();
  const jsonFile = await json;
  expect(jsonFile.suggestedFilename()).toBe("fixture_annotations.json");
  expect(JSON.parse(readFileSync(await jsonFile.path(), "utf8"))).toEqual([
    { onset: 2.5, duration: 1, trial_type: "eyes closed" },
    { onset: 4.25, duration: 1.5, trial_type: "burst" },
    { onset: 20, duration: 0, trial_type: "spike" },
  ]);
});
