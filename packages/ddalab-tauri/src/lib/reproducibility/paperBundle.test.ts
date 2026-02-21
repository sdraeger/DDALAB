import { describe, expect, it } from "vitest";
import {
  createPaperReproBundle,
  getDefaultPaperBundleFilename,
} from "./paperBundle";
import type { DDAResult } from "@/types/api";

function makeResult(): DDAResult {
  return {
    id: "analysis-123",
    name: "Clinical Seizure Run",
    file_path: "/tmp/test.edf",
    channels: ["Fp1", "Fp2"],
    parameters: {
      file_path: "/tmp/test.edf",
      channels: ["Fp1", "Fp2"],
      start_time: 0,
      end_time: 30,
      variants: ["single_timeseries"],
      window_length: 100,
      window_step: 10,
      delay_list: [7, 10],
    },
    results: {
      window_indices: [0, 10, 20],
      variants: [
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {
            Fp1: [0.1, 0.2, 0.3],
            Fp2: [0.4, 0.5, 0.6],
          },
          exponents: { Fp1: 0.3, Fp2: 0.4 },
          quality_metrics: {},
        },
      ],
    },
    status: "completed",
    created_at: "2026-02-16T00:00:00.000Z",
  };
}

describe("paperBundle", () => {
  it("creates a reproducibility bundle with stable core fields", () => {
    const result = makeResult();
    const bundle = createPaperReproBundle(result, {
      appVersion: "1.2.8",
      selectedVariantId: "single_timeseries",
      selectedVariantName: "Single Timeseries",
      selectedChannels: ["Fp1", "Fp2"],
      viewMode: "all",
      colorScheme: "viridis",
    });

    expect(bundle.bundle_version).toBe("1.0.0");
    expect(bundle.application.version).toBe("1.2.8");
    expect(bundle.analysis.id).toBe("analysis-123");
    expect(bundle.active_view.variant_id).toBe("single_timeseries");
    expect(bundle.reviewer_checklist.length).toBeGreaterThan(2);
    expect(bundle.evidence_fingerprint).toMatch(/^[a-f0-9]{8}$/);
  });

  it("creates deterministic evidence fingerprints for identical inputs", () => {
    const result = makeResult();
    const context = {
      appVersion: "1.2.8",
      selectedVariantId: "single_timeseries",
      selectedVariantName: "Single Timeseries",
      selectedChannels: ["Fp1", "Fp2"],
      viewMode: "all",
      colorScheme: "viridis",
    };

    const a = createPaperReproBundle(result, context);
    const b = createPaperReproBundle(result, context);
    expect(a.evidence_fingerprint).toBe(b.evidence_fingerprint);
  });

  it("generates a sanitized default filename", () => {
    const filename = getDefaultPaperBundleFilename(makeResult());
    expect(filename).toBe("dda_paper_bundle_clinical_seizure_run.json");
  });
});
