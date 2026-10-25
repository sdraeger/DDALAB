import { expect, test } from "@playwright/test";

test("page_shows_engine_version", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(/^\d+\.\d+\.\d+/);
});
