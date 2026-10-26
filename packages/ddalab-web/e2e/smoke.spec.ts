import { readFileSync } from "node:fs";
import { TAB_KEYS } from "../src/features/tabs/keys";
import { expect, test } from "./test";

test("page_shows_engine_version", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Library" }).getByRole("status")).toHaveText(
    /^\d+\.\d+\.\d+/,
  );
});

test("about_names_the_authors_and_versions_and_credits_the_color_maps", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "About DDALAB" }).click();
  const about = page.getByRole("dialog", { name: "About DDALAB" });
  await expect(about).toContainText("By Simon Dräger, Claudia Lainscsek and Terrence J. Sejnowski");
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const engine = await page.evaluate(() => window.__ddalab.engine.version());
  // The versions, then what each tab shortcut does.
  await expect(about.getByRole("definition")).toHaveText([
    version,
    engine.engine_version,
    engine.git_commit ?? "not recorded in this build",
    ...TAB_KEYS.map(([, action]) => action),
  ]);
  // The color map credit stands under its own heading, apart from DDALAB's authors.
  const colorMaps = about.getByRole("region", { name: "Color maps" });
  await expect(colorMaps).toContainText(
    "Crameri, F. (2018). Scientific colour maps. Zenodo. doi:10.5281/zenodo.1243862",
  );
  await expect(colorMaps).toContainText("MIT License, Copyright (c) 2020 Fabio Crameri");
});
