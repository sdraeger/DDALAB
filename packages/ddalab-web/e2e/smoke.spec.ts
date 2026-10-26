import { readFileSync } from "node:fs";
import { expect, test } from "./test";

test("page_shows_engine_version", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(/^\d+\.\d+\.\d+/);
});

test("about_names_the_versions_and_credits_the_color_maps", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "About DDALAB" }).click();
  const about = page.getByRole("dialog", { name: "About DDALAB" });
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const engine = await page.evaluate(() => window.__ddalab.engine.version());
  await expect(about.getByRole("definition")).toHaveText([
    version,
    engine.engine_version,
    engine.git_commit ?? "not recorded in this build",
  ]);
  await expect(about).toContainText(
    "Crameri, F. (2018). Scientific colour maps. Zenodo. doi:10.5281/zenodo.1243862",
  );
  await expect(about).toContainText("MIT License, Copyright (c) 2020 Fabio Crameri");
});
