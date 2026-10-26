// The installed app's window: the application menu by keyboard and pointer and its shortcuts, New window with tabs of
// its own, Reopen window bringing a closed window's tabs back, and the command bar in the title bar area, the window
// controls overlay stood in for by the CSS properties it sets (Playwright cannot turn it on).
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "./test";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../dda-rs/tests/fixtures/${name}`, import.meta.url));
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open recordings" }).getByRole("tab");
const menu = (page: Page) => page.getByRole("menubar").getByRole("menuitem", { name: "DDALAB" });
const item = (page: Page, name: string | RegExp) => page.getByRole("menuitem", { name, exact: true });

/** Runs `path`, the names from the menu's first level down, by pointer. */
async function choose(page: Page, ...path: (string | RegExp)[]) {
  await menu(page).click();
  for (const name of path) await item(page, name).click();
}

test.beforeEach(async ({ page }) => {
  // Playwright drives no browser picker: the <input> paths open the files.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });
  await page.goto("/");
  await expect(menu(page)).toBeVisible();
});

test("the_menu_opens_and_runs_an_item_by_keyboard_and_gives_the_focus_back", async ({ page }) => {
  const library = page.getByRole("button", { name: "Library", exact: true });
  await expect(library).toHaveAttribute("aria-pressed", "true");
  await menu(page).focus();
  await page.keyboard.press("Enter");
  await expect(item(page, "File")).toBeFocused();
  // A frame for the trigger's own check of where the focus went: a key in the same instant closes the menu again.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  // View, then its first item: the library's toggle.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  const toggle = page.getByRole("menuitemcheckbox", { name: /^Library/ });
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Enter");
  await expect(library).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(menu(page)).toBeFocused();
  // Escape closes the menu and leaves the focus on its trigger.
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "File")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(menu(page)).toBeFocused();
});

test("the_shortcuts_run_the_bars_and_rails_own_controls", async ({ page }) => {
  const library = page.getByRole("button", { name: "Library", exact: true });
  const inspector = page.getByRole("button", { name: "Inspector", exact: true });
  await page.keyboard.press("ControlOrMeta+B");
  await expect(library).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(inspector).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Display calibration" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Open files with the library closed: the rail's picker opens all the same.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("ControlOrMeta+O"),
  ]);
  await chooser.setFiles(fixture("fixture.edf"));
  await expect(tabs(page)).toHaveText(["fixture.edf"]);
  // Export project opens the rail and its popover there.
  await page.keyboard.press("ControlOrMeta+Shift+E");
  await expect(library).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Save project" })).toBeVisible();
});

test("the_menu_sets_the_theme_and_opens_the_shortcuts_and_about", async ({ page }) => {
  const root = page.locator("html");
  await choose(page, "View");
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#1D2226");
  await choose(page, "View");
  await page.getByRole("menuitemradio", { name: "System" }).click();
  await expect(root).not.toHaveAttribute("data-theme");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#F1F3F5");

  await choose(page, "Help", "Keyboard shortcuts");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toContainText("Show or hide the library");
  await expect(shortcuts).toContainText("Jump to a tab");
  await page.keyboard.press("Escape");
  await expect(shortcuts).toBeHidden();
  await expect(menu(page)).toBeFocused();
  await choose(page, "Help", "About DDALAB");
  await expect(page.getByRole("dialog", { name: "About DDALAB" })).toContainText("Fabio Crameri");
});

test("new_window_has_tabs_of_its_own_and_reopen_window_brings_a_closed_ones_back", async ({ page }) => {
  await page.getByLabel("Recording files").setInputFiles(fixture("fixture.edf"));
  await expect(tabs(page)).toHaveText(["fixture.edf"]);
  const [other] = await Promise.all([
    page.context().waitForEvent("page"),
    choose(page, "Window", /^New window/),
  ]);
  await other.addInitScript(() => Reflect.deleteProperty(window, "showOpenFilePicker"));
  await expect(other.getByText("Open a recording from the library")).toBeVisible();
  await expect(tabs(other)).toHaveCount(0);
  await other.getByLabel("Recording files").setInputFiles(fixture("fixture.bdf"));
  await expect(tabs(other)).toHaveText(["fixture.bdf"]);
  // The recent list is shared: the first window lists what the other opened.
  await expect(page.getByRole("region", { name: "Recent recordings" })).toContainText("fixture.bdf");
  // Each window keeps its own: a reload of either brings back its tabs alone.
  await other.evaluate(() => window.__ddalab.tabs.flush());
  await page.evaluate(() => window.__ddalab.tabs.flush());
  await other.reload();
  await expect(tabs(other)).toHaveText(["fixture.bdf, detached"]);
  await expect(tabs(page)).toHaveText(["fixture.edf"]);
  await other.close();

  // Once its window has closed and let go of it, the saved window is listed, and reopens in a window of its own.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await choose(page, "Window");
    await expect(item(page, "fixture.bdf")).toBeVisible({ timeout: 500 });
  }).toPass();
  const [reopened] = await Promise.all([
    page.context().waitForEvent("page"),
    item(page, "fixture.bdf").click(),
  ]);
  await expect(tabs(reopened)).toHaveText(["fixture.bdf, detached"]);
  await choose(page, "Window");
  await expect(item(page, "Reopen window")).toHaveAttribute("aria-disabled", "true");
});

test("the_bar_takes_the_title_bar_area_beside_the_window_controls", async ({ page }) => {
  await page.evaluate(() =>
    window.__ddalab.openSynthetic({ channels: 2, rateHz: 256, durationS: 600, seed: 5 }),
  );
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  const bar = page.getByRole("banner");
  expect((await bar.boundingBox())?.height).toBe(44);
  for (const [x, width] of [
    [80, 1280 - 80], // macOS: the traffic lights on the left
    [0, 1280 - 138], // Windows: the caption buttons on the right
  ]) {
    await page.evaluate(
      ({ x, width }) => {
        const root = document.documentElement.style;
        root.setProperty("--titlebar-x", `${x}px`);
        root.setProperty("--titlebar-y", "0px");
        root.setProperty("--titlebar-width", `${width}px`);
        root.setProperty("--titlebar-height", "33px");
      },
      { x, width },
    );
    expect((await bar.boundingBox())?.height).toBe(33);
    const outside = await bar.evaluate(
      (header, { x, width }) =>
        [...header.querySelectorAll("button, [role='combobox']")]
          .filter((e) => e.checkVisibility())
          .filter((e) => {
            const box = e.getBoundingClientRect();
            return box.left < x || box.right > x + width || box.top < 0 || box.bottom > 33;
          })
          .map((e) => e.getAttribute("aria-label") ?? e.textContent),
      { x, width },
    );
    expect(outside, `title bar area from ${x} px, ${width} px wide`).toEqual([]);
  }
});
