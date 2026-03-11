import { expect, test } from "@playwright/test";
import path from "path";
import {
  getFileChunk,
  getFileInfo,
  listFiles,
  TEST_FILES,
  waitForApiServer,
} from "../utils/api-helpers";

const legacyApiServerEnabled = process.env.START_API_SERVER === "true";

test.describe("File loading via legacy API server", () => {
  test.skip(
    !legacyApiServerEnabled,
    "Requires START_API_SERVER=true and the legacy API server",
  );

  test.setTimeout(60000);

  test.beforeAll(async () => {
    const isReady = await waitForApiServer(60, 1000);
    expect(isReady).toBe(true);
  });

  test("lists deterministic fixtures from the data directory", async () => {
    const files = await listFiles();
    const fileNames = new Set(files.map((file) => file.name));

    expect(fileNames.has(path.basename(TEST_FILES.SMALL_EDF))).toBe(true);
    expect(fileNames.has(path.basename(TEST_FILES.CSV))).toBe(true);
    expect(fileNames.has(path.basename(TEST_FILES.ASCII))).toBe(true);
  });

  test("returns usable metadata for EDF, CSV, and ASCII fixtures", async () => {
    for (const fixturePath of Object.values(TEST_FILES)) {
      const fileInfo = await getFileInfo(fixturePath);

      expect(fileInfo.file_path).toBe(fixturePath);
      expect(fileInfo.channels.length).toBeGreaterThanOrEqual(2);
      expect(fileInfo.file_size).toBeGreaterThan(0);
      expect(fileInfo.sample_rate).toBeGreaterThan(0);
      expect(fileInfo.total_samples ?? 0).toBeGreaterThan(0);
      expect(fileInfo.duration ?? 0).toBeGreaterThan(0);
    }
  });

  test("reads EDF chunks with channel labels and sample data", async () => {
    const fileInfo = await getFileInfo(TEST_FILES.SMALL_EDF);
    const selectedChannels = fileInfo.channels.slice(0, 2);
    const chunk = await getFileChunk(
      TEST_FILES.SMALL_EDF,
      0,
      1,
      selectedChannels,
    );

    expect(chunk.channelLabels).toEqual(selectedChannels);
    expect(chunk.data.length).toBe(selectedChannels.length);
    expect(chunk.chunkSize).toBeGreaterThan(0);
    expect(chunk.samplingFrequency).toBeGreaterThan(0);

    for (const series of chunk.data) {
      expect(series.length).toBe(chunk.chunkSize);
      expect(series.some((value) => Number.isFinite(value))).toBe(true);
    }
  });

  test("reads CSV chunks without degenerate data", async () => {
    const fileInfo = await getFileInfo(TEST_FILES.CSV);
    const selectedChannels = fileInfo.channels.slice(0, 2);
    const chunk = await getFileChunk(TEST_FILES.CSV, 0, 16, selectedChannels);

    expect(chunk.channelLabels).toEqual(selectedChannels);
    expect(chunk.data.length).toBe(selectedChannels.length);
    expect(chunk.chunkSize).toBeGreaterThan(4);

    const flattened = chunk.data
      .flat()
      .filter((value) => Number.isFinite(value));
    expect(flattened.length).toBeGreaterThan(0);
    expect(
      new Set(flattened.map((value) => Math.round(value * 1000))).size,
    ).toBeGreaterThan(1);
  });
});
