import { expect, test } from "@playwright/test";
import path from "path";
import {
  buildDDARequestFromFileInfo,
  getFileInfo,
  runDDAAnalysisViaApi,
  TEST_FILES,
  waitForApiServer,
  type DDAExecutionResult,
} from "../utils/api-helpers";

const legacyApiServerEnabled = process.env.START_API_SERVER === "true";

function assertSensibleResult(
  result: DDAExecutionResult,
  expectedFilePath: string,
): void {
  expect(result.status).toBe("completed");
  expect(result.file_path).toBe(expectedFilePath);
  expect(result.results.summary.total_windows).toBeGreaterThan(0);
  expect(result.results.summary.processed_windows).toBeGreaterThan(0);
  expect(Number.isFinite(result.results.summary.mean_complexity)).toBe(true);
  expect(Number.isFinite(result.results.summary.std_complexity)).toBe(true);
  expect(result.results.variants.length).toBeGreaterThan(0);

  const populatedVariant = result.results.variants.find((variant) =>
    Object.values(variant.dda_matrix).some((series) => series.length > 0),
  );

  expect(populatedVariant).toBeDefined();

  const seriesEntries = Object.entries(populatedVariant!.dda_matrix);
  expect(seriesEntries.length).toBeGreaterThan(0);

  const seriesLengths = new Set(
    seriesEntries.map(([, series]) => series.length),
  );
  expect(seriesLengths.size).toBe(1);

  const [windowCount] = [...seriesLengths];
  expect(windowCount).toBeGreaterThan(2);

  if (Array.isArray(result.results.scales)) {
    expect(result.results.scales.length).toBe(windowCount);
  }

  if (Array.isArray(result.results.error_values)) {
    expect(result.results.error_values.length).toBe(windowCount);
  }

  if (Array.isArray(populatedVariant!.error_values)) {
    expect(populatedVariant!.error_values.length).toBe(windowCount);
  }

  const finiteValues = seriesEntries.flatMap(([, series]) =>
    series.filter((value) => Number.isFinite(value)),
  );
  expect(finiteValues.length).toBeGreaterThan(0);

  const absoluteMax = Math.max(...finiteValues.map((value) => Math.abs(value)));
  expect(absoluteMax).toBeGreaterThan(0);

  const roundedValues = new Set(
    finiteValues.map((value) => Math.round(value * 1000) / 1000),
  );
  expect(roundedValues.size).toBeGreaterThan(1);
}

async function runAnalysisForFixture(filePath: string): Promise<void> {
  const fileInfo = await getFileInfo(filePath);
  expect(fileInfo.channels.length).toBeGreaterThanOrEqual(2);

  const request = buildDDARequestFromFileInfo(fileInfo, filePath);
  const result = await runDDAAnalysisViaApi(request);

  expect(result.channels.length).toBe(request.channels?.length ?? 0);
  expect(result.results.summary.num_channels).toBeGreaterThanOrEqual(
    request.channels?.length ?? 0,
  );
  assertSensibleResult(result, filePath);
}

test.describe("DDA execution via legacy API server", () => {
  test.skip(
    !legacyApiServerEnabled,
    "Requires START_API_SERVER=true and the legacy API server",
  );

  test.setTimeout(120000);

  test.beforeAll(async () => {
    const isReady = await waitForApiServer(60, 1000);
    expect(isReady).toBe(true);
  });

  for (const [label, filePath] of [
    ["EDF", TEST_FILES.SMALL_EDF],
    ["CSV", TEST_FILES.CSV],
    ["ASCII", TEST_FILES.ASCII],
  ] as const) {
    test(`runs DDA end-to-end on ${label} fixture ${path.basename(filePath)}`, async () => {
      await runAnalysisForFixture(filePath);
    });
  }
});
