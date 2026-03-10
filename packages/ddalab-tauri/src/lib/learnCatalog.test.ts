import { describe, expect, it } from "vitest";
import {
  getCatalogErrorMessage,
  getSampleDownloadErrorMessage,
  parsePaperRecipesIndex,
  parseSampleDataIndex,
} from "@/lib/learnCatalog";

describe("learnCatalog", () => {
  describe("parseSampleDataIndex", () => {
    it("returns datasets from a valid catalog payload", () => {
      const datasets = parseSampleDataIndex(
        JSON.stringify({
          version: "1",
          datasets: [
            {
              id: "demo-eeg",
              name: "Demo EEG",
              description: "Sample recording",
              format: "EDF",
              sizeBytes: 1024,
              url: "https://example.com/demo.edf",
              channels: 16,
              duration: "00:30",
              sampleRate: 256,
            },
          ],
        }),
      );

      expect(datasets).toHaveLength(1);
      expect(datasets[0]?.id).toBe("demo-eeg");
    });

    it("throws a clear error for malformed catalog data", () => {
      expect(() =>
        parseSampleDataIndex(
          JSON.stringify({
            version: "1",
            datasets: [{ id: "broken-entry" }],
          }),
        ),
      ).toThrow(
        "The sample data catalog is malformed. Please try again later.",
      );
    });
  });

  describe("parsePaperRecipesIndex", () => {
    it("returns recipes from a valid catalog payload", () => {
      const recipes = parsePaperRecipesIndex(
        JSON.stringify({
          version: "1",
          recipes: [
            {
              id: "recipe-1",
              citation: {
                authors: "Doe et al.",
                title: "DDA in Practice",
                journal: "Journal of DDA",
                year: 2025,
              },
              description: "Reproduce the main figure.",
              dataset: {
                source: "sample-data",
                id: "demo-eeg",
              },
              steps: {
                channels: ["C3", "C4"],
                variant: "ST",
                parameters: {
                  tau: [7, 10],
                  windowLength: 1024,
                },
              },
            },
          ],
        }),
      );

      expect(recipes).toHaveLength(1);
      expect(recipes[0]?.dataset.source).toBe("sample-data");
    });

    it("throws a clear error for unreadable catalog JSON", () => {
      expect(() => parsePaperRecipesIndex("{")).toThrow(
        "DDALAB received an unreadable paper recipe catalog response.",
      );
    });
  });

  describe("error messages", () => {
    it("normalizes network failures for remote catalogs", () => {
      expect(
        getCatalogErrorMessage(
          "sample data catalog",
          new Error("network connection refused"),
        ),
      ).toBe(
        "Could not refresh the sample data catalog. Check your connection and try again.",
      );
    });

    it("keeps schema validation errors intact for remote catalogs", () => {
      expect(
        getCatalogErrorMessage(
          "paper recipe catalog",
          new Error(
            "The paper recipe catalog is malformed. Please try again later.",
          ),
        ),
      ).toBe("The paper recipe catalog is malformed. Please try again later.");
    });

    it("normalizes sample download failures", () => {
      expect(
        getSampleDownloadErrorMessage(
          "Demo EEG",
          new Error("request timed out while downloading"),
        ),
      ).toBe(
        'Could not download "Demo EEG". Check your connection and try again.',
      );
    });
  });
});
