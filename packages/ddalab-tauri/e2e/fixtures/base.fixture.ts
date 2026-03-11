import { test as base, Page, expect } from "@playwright/test";
import { startCoverage, stopCoverage } from "../utils/coverage";
import {
  isApiServerRunning,
  loadFileViaUI,
  selectChannels,
  runDDAAnalysis,
  TEST_FILES,
  API_URL,
} from "../utils/api-helpers";

// Test data file path (relative to monorepo root)
export const TEST_EDF_PATH = TEST_FILES.SMALL_EDF;

// Re-export API helpers for convenience
export {
  isApiServerRunning,
  loadFileViaUI,
  selectChannels,
  runDDAAnalysis,
  TEST_FILES,
  API_URL,
};

const COLLECT_COVERAGE = process.env.COVERAGE === "true";

const defaultPrimaryViews: Record<Exclude<PrimaryNav, "manage">, string> = {
  overview: "overview",
  explore: "explore-timeseries",
  analyze: "analyze-dda",
  data: "data-openneuro",
  learn: "learn-tutorials",
  plugins: "plugins",
  collaborate: "collaborate-gallery",
  settings: "settings",
  notifications: "notifications",
};

const secondaryViews: Record<string, string> = {
  timeseries: "explore-timeseries",
  annotations: "explore-annotations",
  streaming: "explore-streaming",
  dda: "analyze-dda",
  ica: "analyze-ica",
  batch: "analyze-batch",
  compare: "analyze-compare",
  openneuro: "data-openneuro",
  "nsg-jobs": "data-nsg-jobs",
  tutorials: "learn-tutorials",
  "sample-data": "learn-sample-data",
  papers: "learn-papers",
  gallery: "collaborate-gallery",
};

function activeView(page: Page, viewId: string) {
  return page.locator(`[data-view-id="${viewId}"][data-active="true"]`).first();
}

async function waitForView(page: Page, viewId: string) {
  await expect(activeView(page, viewId)).toBeVisible({ timeout: 15000 });
}

async function waitForPrimaryNavigationInteractivity(page: Page) {
  try {
    await page.waitForFunction(
      () => {
        const button = document.querySelector(
          '[data-testid="primary-navigation"] [data-nav="overview"]',
        );

        if (!button) {
          return false;
        }

        return Object.keys(button).some((key) =>
          key.startsWith("__reactProps"),
        );
      },
      { timeout: 10000 },
    );
  } catch {
    // Fail open in slower dev-server runs. Navigation helpers still have a DOM-click fallback.
    await page.waitForTimeout(1000);
  }
}

async function dismissOnboardingIfVisible(page: Page) {
  const onboardingDialog = page.getByRole("dialog", {
    name: /welcome to ddalab/i,
  });

  if (!(await onboardingDialog.isVisible().catch(() => false))) {
    return;
  }

  const skipTourButton = onboardingDialog.getByRole("button", {
    name: /skip tour/i,
  });

  if (await skipTourButton.isVisible().catch(() => false)) {
    await skipTourButton.click();
    await onboardingDialog.waitFor({ state: "hidden", timeout: 5000 });
  }
}

/**
 * Wait for the app to be ready (basic DOM ready, main content exists)
 */
export async function waitForAppReady(page: Page) {
  // Wait for the page to be fully loaded
  await page.waitForLoadState("domcontentloaded");

  // Wait for main content OR nav to be visible (either indicates app loaded)
  await page
    .locator("main, nav, [data-nav]")
    .first()
    .waitFor({ state: "visible", timeout: 15000 });

  // Give React a moment to hydrate
  await page.waitForTimeout(500);
  await waitForPrimaryNavigationInteractivity(page);
  await page
    .locator('[data-testid="navigation-content"]')
    .waitFor({ state: "visible", timeout: 15000 });
  await waitForView(page, "explore-timeseries");
  await dismissOnboardingIfVisible(page);
}

/**
 * Primary navigation tabs in the app
 */
export type PrimaryNav =
  | "overview"
  | "explore"
  | "analyze"
  | "data"
  | "learn"
  | "plugins"
  | "collaborate"
  | "settings"
  | "manage"
  | "notifications";

/**
 * Secondary navigation tabs
 */
export type SecondaryNav =
  | "timeseries"
  | "annotations"
  | "streaming"
  | "dda"
  | "ica"
  | "batch"
  | "compare"
  | "openneuro"
  | "nsg-jobs"
  | "tutorials"
  | "sample-data"
  | "papers"
  | "gallery"
  | "preprocessing"
  | "settings"
  | "data-sources"
  | "jobs";

const primaryNavAlias: Record<string, string> = {
  manage: "settings",
};

const secondaryNavAlias: Record<string, string> = {
  "data-sources": "openneuro",
  jobs: "nsg-jobs",
};

/**
 * Navigate to a primary section of the app
 */
export async function navigateTo(page: Page, section: PrimaryNav) {
  await dismissOnboardingIfVisible(page);
  const resolvedSection = primaryNavAlias[section] ?? section;
  const navButton = page.locator(`[data-nav="${resolvedSection}"]`).first();
  try {
    await navButton.click();
  } catch {
    // Close any modal/popover overlay that may block top navigation.
    await page.keyboard.press("Escape").catch(() => undefined);
    await navButton.click({ force: true });
  }
  if ((await navButton.getAttribute("data-active")) !== "true") {
    await navButton.evaluate((element) =>
      (element as HTMLButtonElement).click(),
    );
  }
  await expect(navButton).toHaveAttribute("data-active", "true", {
    timeout: 10000,
  });
  const defaultView =
    defaultPrimaryViews[resolvedSection as Exclude<PrimaryNav, "manage">];
  if (defaultView) {
    await waitForView(page, defaultView);
  }
}

/**
 * Navigate to a secondary tab within the current primary section
 */
export async function navigateToSecondary(page: Page, tab: SecondaryNav) {
  await dismissOnboardingIfVisible(page);
  const resolvedTab = secondaryNavAlias[tab] ?? tab;
  const tabButton = page.locator(`[data-nav="${resolvedTab}"]`).first();
  if (await tabButton.isVisible()) {
    await tabButton.click();
    if ((await tabButton.getAttribute("data-active")) !== "true") {
      await tabButton.evaluate((element) =>
        (element as HTMLButtonElement).click(),
      );
    }
    await expect(tabButton).toHaveAttribute("data-active", "true", {
      timeout: 10000,
    });
    const viewId = secondaryViews[resolvedTab];
    if (viewId) {
      await waitForView(page, viewId);
    }
  }
}

/**
 * Extended test fixture with coverage collection and helpers.
 * Override the page fixture to automatically collect coverage when COVERAGE=true.
 */
export const test = base.extend<{
  appReady: void;
  apiAvailable: boolean;
  withTestFile: void;
}>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("ddalab_onboarding_completed", "true");
    });

    if (COLLECT_COVERAGE) {
      await startCoverage(page);
    }
    await use(page);
    if (COLLECT_COVERAGE) {
      await stopCoverage(page);
    }
  },
  appReady: async ({ page }, use) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await use();
  },
  apiAvailable: async ({}, use) => {
    const available = await isApiServerRunning();
    await use(available);
  },
  withTestFile: async ({ page, apiAvailable }, use) => {
    // This fixture loads a test file if the API is available
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

    if (apiAvailable) {
      // Load the small test EDF file
      await loadFileViaUI(page, TEST_FILES.SMALL_EDF);
    }

    await use();
  },
});

export { expect } from "@playwright/test";
