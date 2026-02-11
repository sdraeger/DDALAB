import { describe, it, expect } from "vitest";
import {
  generatePythonScript,
  getDefaultPythonFilename,
} from "../pythonExport";
import {
  generateMatlabScript,
  getDefaultMatlabFilename,
} from "../matlabExport";
import { generateJuliaScript, getDefaultJuliaFilename } from "../juliaExport";
import { generateRustScript, getDefaultRustFilename } from "../rustExport";
import type { DDAResult } from "@/types/api";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeMinimalResult(overrides: Partial<DDAResult> = {}): DDAResult {
  return {
    id: "abc12345-6789-0000-0000-000000000000",
    name: "test_analysis",
    file_path: "/data/recordings/subject01.edf",
    channels: ["Fp1", "Fp2", "C3", "C4"],
    parameters: {
      file_path: "/data/recordings/subject01.edf",
      channels: ["Fp1", "Fp2", "C3", "C4"],
      start_time: 0,
      end_time: 30,
      variants: ["single_timeseries"],
      window_length: 100,
      window_step: 10,
      delay_list: [1, 2, 3, 4, 5],
    },
    results: {
      window_indices: [0, 10, 20, 30, 40],
      variants: [
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {
            Fp1: [0.5, 0.6, 0.7, 0.8, 0.9],
            Fp2: [1.1, 1.2, 1.3, 1.4, 1.5],
            C3: [0.1, 0.2, 0.3, 0.4, 0.5],
            C4: [2.0, 2.1, 2.2, 2.3, 2.4],
          },
          exponents: {
            Fp1: 1.234,
            Fp2: 0.987,
            C3: 1.567,
            C4: 0.789,
          },
          quality_metrics: {},
        },
      ],
    },
    status: "completed",
    created_at: "2026-01-15T10:30:00.000Z",
    ...overrides,
  };
}

function makeMultiVariantResult(): DDAResult {
  return makeMinimalResult({
    results: {
      window_indices: [0, 10, 20],
      variants: [
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {
            Fp1: [0.5, 0.6, 0.7],
            Fp2: [1.1, 1.2, 1.3],
          },
          exponents: { Fp1: 1.234, Fp2: 0.987 },
          quality_metrics: {},
        },
        {
          variant_id: "delay_embedding",
          variant_name: "Delay Embedding",
          dda_matrix: {
            Fp1: [0.9, 0.8, 0.7],
            Fp2: [0.3, 0.2, 0.1],
          },
          exponents: { Fp1: 2.345, Fp2: 1.876 },
          quality_metrics: {},
        },
      ],
    },
  });
}

function makeResultWithNaN(): DDAResult {
  return makeMinimalResult({
    results: {
      window_indices: [0, 10, 20],
      variants: [
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {
            Fp1: [0.5, NaN, 0.7],
            Fp2: [Infinity, 1.2, -Infinity],
          },
          exponents: { Fp1: 1.0 },
          quality_metrics: {},
        },
      ],
    },
  });
}

function makeResultWithErrorValues(): DDAResult {
  return makeMinimalResult({
    results: {
      window_indices: [0, 10, 20, 30, 40],
      error_values: [0.01, 0.02, 0.03, 0.04, 0.05],
      variants: [
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {
            Fp1: [0.5, 0.6, 0.7, 0.8, 0.9],
          },
          exponents: { Fp1: 1.234 },
          quality_metrics: {},
        },
      ],
    },
  });
}

function makeResultWithOptionalParams(): DDAResult {
  return makeMinimalResult({
    parameters: {
      file_path: "/data/recordings/subject01.edf",
      channels: ["Fp1", "Fp2"],
      start_time: 0,
      end_time: 30,
      variants: ["single_timeseries"],
      window_length: 200,
      window_step: 20,
      delay_list: [1, 2, 3],
      model_dimension: 6,
      polynomial_order: 5,
      nr_tau: 3,
      model_params: [1, 0, 1, 0, 1],
    },
  });
}

function makeEmptyVariantResult(): DDAResult {
  return makeMinimalResult({
    results: {
      window_indices: [],
      variants: [
        {
          variant_id: "empty",
          variant_name: "Empty",
          dda_matrix: {},
          exponents: {},
          quality_metrics: {},
        },
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {
            Fp1: [0.5, 0.6],
          },
          exponents: { Fp1: 1.0 },
          quality_metrics: {},
        },
      ],
    },
  });
}

function makeResultWithNoWindowIndices(): DDAResult {
  return makeMinimalResult({
    results: {
      window_indices: [],
      variants: [
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {
            Fp1: [0.5, 0.6, 0.7],
          },
          exponents: {},
          quality_metrics: {},
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Python Export Tests
// ---------------------------------------------------------------------------

describe("generatePythonScript", () => {
  it("generates valid Python with all required sections", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain("#!/usr/bin/env python3");
    expect(script).toContain("import numpy as np");
    expect(script).toContain("import json");
    expect(script).toContain("from pathlib import Path");
    expect(script).toContain('if __name__ == "__main__":');
  });

  it("embeds analysis ID and metadata in docstring", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain(
      "Analysis ID: abc12345-6789-0000-0000-000000000000",
    );
    expect(script).toContain("Source file: subject01.edf");
    expect(script).toContain("Created:     2026-01-15T10:30:00.000Z");
  });

  it("embeds all analysis parameters in PARAMS dict", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain(`"file_path": "/data/recordings/subject01.edf"`);
    expect(script).toContain(`"channels": ["Fp1","Fp2","C3","C4"]`);
    expect(script).toContain(`"start_time": 0`);
    expect(script).toContain(`"end_time": 30`);
    expect(script).toContain(`"window_length": 100`);
    expect(script).toContain(`"window_step": 10`);
    expect(script).toContain(`"delays": [1,2,3,4,5]`);
  });

  it("embeds optional parameters when present", () => {
    const result = makeResultWithOptionalParams();
    const script = generatePythonScript(result);

    expect(script).toContain(`"model_dimension": 6`);
    expect(script).toContain(`"polynomial_order": 5`);
    expect(script).toContain(`"nr_tau": 3`);
    expect(script).toContain(`"model_params": [1,0,1,0,1]`);
  });

  it("omits optional parameters when absent", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).not.toContain("model_dimension");
    expect(script).not.toContain("polynomial_order");
    expect(script).not.toContain("nr_tau");
  });

  it("embeds DDA matrix values as numpy arrays", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain(`"Fp1": np.array([`);
    expect(script).toContain(`"Fp2": np.array([`);
    expect(script).toContain(`"C3": np.array([`);
    expect(script).toContain(`"C4": np.array([`);
  });

  it("embeds exponents per channel", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain(`"Fp1": 1.234`);
    expect(script).toContain(`"Fp2": 0.987`);
    expect(script).toContain(`"C3": 1.567`);
    expect(script).toContain(`"C4": 0.789`);
  });

  it("embeds window indices as numpy array", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain("window_indices = np.array([0,10,20,30,40])");
  });

  it("computes window indices from step when not provided", () => {
    const result = makeResultWithNoWindowIndices();
    const script = generatePythonScript(result);

    expect(script).toContain("window_indices = np.arange(0,");
  });

  it("handles NaN and Infinity values", () => {
    const result = makeResultWithNaN();
    const script = generatePythonScript(result);

    expect(script).toContain("np.nan");
    // Infinity is not finite, so should become np.nan
    const fpLine = script
      .split("\n")
      .find((l) => l.includes('"Fp2"') && l.includes("np.array"));
    expect(fpLine).toContain("np.nan");
  });

  it("embeds error values when present", () => {
    const result = makeResultWithErrorValues();
    const script = generatePythonScript(result);

    expect(script).toContain('"error_values": np.array([');
  });

  it("filters to a single variant when specified", () => {
    const result = makeMultiVariantResult();
    const script = generatePythonScript(result, {
      variant: "delay_embedding",
    });

    expect(script).toContain("Delay Embedding");
    expect(script).not.toContain('results["single_timeseries"]');
    expect(script).toContain('results["delay_embedding"]');
  });

  it("filters to specific channels when specified", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result, { channels: ["Fp1", "C3"] });

    expect(script).toContain('"Fp1": np.array([');
    expect(script).toContain('"C3": np.array([');
    // Fp2 and C4 should not appear in the matrix section
    const matrixSection = script.split("DDA Results")[1]?.split("Window")[0];
    expect(matrixSection).not.toContain('"Fp2": np.array');
    expect(matrixSection).not.toContain('"C4": np.array');
  });

  it("includes all variants when no filter", () => {
    const result = makeMultiVariantResult();
    const script = generatePythonScript(result);

    expect(script).toContain('results["single_timeseries"]');
    expect(script).toContain('results["delay_embedding"]');
  });

  it("skips empty variants", () => {
    const result = makeEmptyVariantResult();
    const script = generatePythonScript(result);

    expect(script).not.toContain('results["empty"]');
    expect(script).toContain('results["single_timeseries"]');
  });

  it("includes MNE-Python loader function", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain("def load_source_data");
    expect(script).toContain("import mne");
    expect(script).toContain(".edf");
    expect(script).toContain(".fif");
    expect(script).toContain(".vhdr");
  });

  it("includes matplotlib visualization function", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    expect(script).toContain("def plot_dda_heatmap");
    expect(script).toContain("import matplotlib.pyplot as plt");
    expect(script).toContain("ax.imshow(");
    expect(script).toContain('cmap="RdBu_r"');
  });

  it("uses 8 significant digits for precision", () => {
    const result = makeMinimalResult();
    result.results.variants[0].dda_matrix.Fp1 = [0.123456789012345];
    const script = generatePythonScript(result);

    // toPrecision(8) of 0.123456789012345 => "0.12345679"
    expect(script).toContain("0.12345679");
  });
});

describe("getDefaultPythonFilename", () => {
  it("generates filename with name, timestamp, and .py extension", () => {
    const result = makeMinimalResult();
    const filename = getDefaultPythonFilename(result);

    expect(filename).toMatch(
      /^dda_test_analysis_reproduce_2026-01-15T10-30-00\.py$/,
    );
  });

  it("falls back to ID prefix when name is missing", () => {
    const result = makeMinimalResult({ name: undefined });
    const filename = getDefaultPythonFilename(result);

    expect(filename).toMatch(/^dda_abc12345_reproduce_/);
    expect(filename).toMatch(/\.py$/);
  });
});

// ---------------------------------------------------------------------------
// MATLAB Export Tests
// ---------------------------------------------------------------------------

describe("generateMatlabScript", () => {
  it("generates valid MATLAB with all required sections", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain("%% Reproducible DDA Analysis");
    expect(script).toContain("params = struct();");
    expect(script).toContain("results = struct();");
    expect(script).toContain("function plot_dda_heatmap");
    expect(script).toContain("fprintf('DDA Analysis:");
  });

  it("embeds analysis ID and metadata in comments", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain(
      "% Analysis ID: abc12345-6789-0000-0000-000000000000",
    );
    expect(script).toContain("% Source file: subject01.edf");
    expect(script).toContain("% Created:     2026-01-15T10:30:00.000Z");
  });

  it("embeds parameters as struct fields", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain(
      "params.file_path = '/data/recordings/subject01.edf';",
    );
    expect(script).toContain("params.channels = {'Fp1', 'Fp2', 'C3', 'C4'};");
    expect(script).toContain("params.start_time = 0;");
    expect(script).toContain("params.end_time = 30;");
    expect(script).toContain("params.window_length = 100;");
    expect(script).toContain("params.window_step = 10;");
    expect(script).toContain("params.delays = [1, 2, 3, 4, 5];");
  });

  it("embeds optional parameters when present", () => {
    const result = makeResultWithOptionalParams();
    const script = generateMatlabScript(result);

    expect(script).toContain("params.model_dimension = 6;");
    expect(script).toContain("params.polynomial_order = 5;");
    expect(script).toContain("params.nr_tau = 3;");
  });

  it("omits optional parameters when absent", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).not.toContain("model_dimension");
    expect(script).not.toContain("polynomial_order");
    expect(script).not.toContain("nr_tau");
  });

  it("embeds DDA matrix as 2D array with semicolon row delimiters", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain("results.single_timeseries.dda_matrix = [");
    // Rows separated by semicolons
    expect(script).toContain(";");
    expect(script).toContain("];");
  });

  it("embeds exponents with channel labels", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain("results.single_timeseries.exponent_channels");
    expect(script).toContain("results.single_timeseries.exponents = [");
    expect(script).toContain("1.234");
    expect(script).toContain("0.987");
  });

  it("embeds window indices as MATLAB array", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain("window_indices = [0, 10, 20, 30, 40];");
  });

  it("computes window indices via colon operator when not provided", () => {
    const result = makeResultWithNoWindowIndices();
    const script = generateMatlabScript(result);

    expect(script).toContain("window_indices = 0:10:");
  });

  it("handles NaN values", () => {
    const result = makeResultWithNaN();
    const script = generateMatlabScript(result);

    expect(script).toContain("NaN");
  });

  it("embeds error values when present", () => {
    const result = makeResultWithErrorValues();
    const script = generateMatlabScript(result);

    expect(script).toContain("results.single_timeseries.error_values = [");
  });

  it("filters to a single variant when specified", () => {
    const result = makeMultiVariantResult();
    const script = generateMatlabScript(result, {
      variant: "delay_embedding",
    });

    expect(script).toContain("Delay Embedding");
    expect(script).toContain("results.delay_embedding");
    expect(script).not.toContain("results.single_timeseries");
  });

  it("filters to specific channels when specified", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result, {
      channels: ["Fp1", "C3"],
    });

    expect(script).toContain("'Fp1'");
    expect(script).toContain("'C3'");
    // channels cell array should only have selected channels
    expect(script).toContain(
      "results.single_timeseries.channels = {'Fp1', 'C3'};",
    );
  });

  it("includes all variants when no filter", () => {
    const result = makeMultiVariantResult();
    const script = generateMatlabScript(result);

    expect(script).toContain("results.single_timeseries");
    expect(script).toContain("results.delay_embedding");
  });

  it("skips empty variants", () => {
    const result = makeEmptyVariantResult();
    const script = generateMatlabScript(result);

    expect(script).not.toContain("results.empty");
    expect(script).toContain("results.single_timeseries");
  });

  it("includes EEGLAB and FieldTrip loader stubs", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain("EEGLAB");
    expect(script).toContain("FieldTrip");
    expect(script).toContain("pop_loadset");
    expect(script).toContain("ft_preprocessing");
  });

  it("includes imagesc visualization function", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    expect(script).toContain("function plot_dda_heatmap");
    expect(script).toContain("imagesc(");
    expect(script).toContain("colormap('jet')");
    expect(script).toContain("colorbar");
  });

  it("escapes single quotes in MATLAB strings", () => {
    const result = makeMinimalResult({
      file_path: "/data/it's a file/test.edf",
    });
    const script = generateMatlabScript(result);

    // MATLAB escapes ' as ''
    expect(script).toContain("it''s a file");
  });

  it("sanitizes variant IDs to valid MATLAB field names", () => {
    const result = makeMinimalResult({
      results: {
        window_indices: [0, 10],
        variants: [
          {
            variant_id: "3-channel.ct",
            variant_name: "3-Channel CT",
            dda_matrix: { Fp1: [0.5, 0.6] },
            exponents: {},
            quality_metrics: {},
          },
        ],
      },
    });
    const script = generateMatlabScript(result);

    // Digits prefixed with v, special chars replaced with _
    expect(script).toContain("results.v3_channel_ct");
  });

  it("uses 8 significant digits for precision", () => {
    const result = makeMinimalResult();
    result.results.variants[0].dda_matrix.Fp1 = [0.123456789012345];
    const script = generateMatlabScript(result);

    expect(script).toContain("0.12345679");
  });
});

describe("getDefaultMatlabFilename", () => {
  it("generates filename with name, timestamp, and .m extension", () => {
    const result = makeMinimalResult();
    const filename = getDefaultMatlabFilename(result);

    expect(filename).toMatch(
      /^dda_test_analysis_reproduce_2026-01-15T10-30-00\.m$/,
    );
  });

  it("falls back to ID prefix when name is missing", () => {
    const result = makeMinimalResult({ name: undefined });
    const filename = getDefaultMatlabFilename(result);

    expect(filename).toMatch(/^dda_abc12345_reproduce_/);
    expect(filename).toMatch(/\.m$/);
  });
});

// ---------------------------------------------------------------------------
// Julia Export Tests
// ---------------------------------------------------------------------------

describe("generateJuliaScript", () => {
  it("generates valid Julia with all required sections", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain("# Reproducible DDA Analysis");
    expect(script).toContain("Dict{String, Any}()");
    expect(script).toContain("function load_source_data");
    expect(script).toContain("function plot_dda_heatmap");
    expect(script).toContain('println("DDA Analysis:');
  });

  it("embeds analysis ID and metadata in comments", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain(
      "# Analysis ID: abc12345-6789-0000-0000-000000000000",
    );
    expect(script).toContain("# Source file: subject01.edf");
    expect(script).toContain("# Created:     2026-01-15T10:30:00.000Z");
  });

  it("embeds parameters as a named tuple", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain("params = (");
    expect(script).toContain(`file_path = "/data/recordings/subject01.edf"`);
    expect(script).toContain(`channels = ["Fp1", "Fp2", "C3", "C4"]`);
    expect(script).toContain("start_time = 0");
    expect(script).toContain("end_time = 30");
    expect(script).toContain("window_length = 100");
    expect(script).toContain("window_step = 10");
    expect(script).toContain("delays = [1, 2, 3, 4, 5]");
  });

  it("embeds optional parameters when present", () => {
    const result = makeResultWithOptionalParams();
    const script = generateJuliaScript(result);

    expect(script).toContain("model_dimension = 6");
    expect(script).toContain("polynomial_order = 5");
    expect(script).toContain("nr_tau = 3");
  });

  it("omits optional parameters when absent", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).not.toContain("model_dimension");
    expect(script).not.toContain("polynomial_order");
    expect(script).not.toContain("nr_tau");
  });

  it("embeds DDA matrix as Dict{String, Vector{Float64}}", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain("Dict{String, Vector{Float64}}(");
    expect(script).toContain('"Fp1" => [');
    expect(script).toContain('"Fp2" => [');
    expect(script).toContain('"C3" => [');
    expect(script).toContain('"C4" => [');
  });

  it("embeds exponents as Dict{String, Float64}", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain("Dict{String, Float64}(");
    expect(script).toContain('"Fp1" => 1.234');
    expect(script).toContain('"Fp2" => 0.987');
  });

  it("embeds window indices as Julia array", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain("window_indices = [0, 10, 20, 30, 40]");
  });

  it("computes window indices via collect() when not provided", () => {
    const result = makeResultWithNoWindowIndices();
    const script = generateJuliaScript(result);

    expect(script).toContain("window_indices = collect(0:");
  });

  it("handles NaN and Infinity values", () => {
    const result = makeResultWithNaN();
    const script = generateJuliaScript(result);

    expect(script).toContain("NaN");
  });

  it("embeds error values when present", () => {
    const result = makeResultWithErrorValues();
    const script = generateJuliaScript(result);

    expect(script).toContain('"error_values" => [');
  });

  it("filters to a single variant when specified", () => {
    const result = makeMultiVariantResult();
    const script = generateJuliaScript(result, {
      variant: "delay_embedding",
    });

    expect(script).toContain("Delay Embedding");
    expect(script).not.toContain('results["single_timeseries"]');
    expect(script).toContain('results["delay_embedding"]');
  });

  it("filters to specific channels when specified", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result, {
      channels: ["Fp1", "C3"],
    });

    expect(script).toContain('"Fp1" => [');
    expect(script).toContain('"C3" => [');
    const matrixSection =
      script.split("DDA Results")[1]?.split("Window")[0] ?? "";
    expect(matrixSection).not.toContain('"Fp2" => [');
    expect(matrixSection).not.toContain('"C4" => [');
  });

  it("includes all variants when no filter", () => {
    const result = makeMultiVariantResult();
    const script = generateJuliaScript(result);

    expect(script).toContain('results["single_timeseries"]');
    expect(script).toContain('results["delay_embedding"]');
  });

  it("skips empty variants", () => {
    const result = makeEmptyVariantResult();
    const script = generateJuliaScript(result);

    expect(script).not.toContain('results["empty"]');
    expect(script).toContain('results["single_timeseries"]');
  });

  it("includes Plots.jl visualization function", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain("using Plots");
    expect(script).toContain("heatmap(");
    expect(script).toContain(":RdBu");
  });

  it("includes EDF.jl loader stub", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    expect(script).toContain("EDF.jl");
    expect(script).toContain("function load_source_data");
  });

  it("properly escapes Julia strings", () => {
    const result = makeMinimalResult({
      file_path: '/data/path with "quotes"/file.edf',
    });
    const script = generateJuliaScript(result);

    expect(script).toContain('\\"quotes\\"');
  });

  it("uses 8 significant digits for precision", () => {
    const result = makeMinimalResult();
    result.results.variants[0].dda_matrix.Fp1 = [0.123456789012345];
    const script = generateJuliaScript(result);

    expect(script).toContain("0.12345679");
  });
});

describe("getDefaultJuliaFilename", () => {
  it("generates filename with name, timestamp, and .jl extension", () => {
    const result = makeMinimalResult();
    const filename = getDefaultJuliaFilename(result);

    expect(filename).toMatch(
      /^dda_test_analysis_reproduce_2026-01-15T10-30-00\.jl$/,
    );
  });

  it("falls back to ID prefix when name is missing", () => {
    const result = makeMinimalResult({ name: undefined });
    const filename = getDefaultJuliaFilename(result);

    expect(filename).toMatch(/^dda_abc12345_reproduce_/);
    expect(filename).toMatch(/\.jl$/);
  });
});

// ---------------------------------------------------------------------------
// Rust Export Tests
// ---------------------------------------------------------------------------

describe("generateRustScript", () => {
  it("generates valid Rust with all required sections", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("//! Reproducible DDA Analysis");
    expect(script).toContain("use std::collections::HashMap;");
    expect(script).toContain("struct DDAVariant {");
    expect(script).toContain("fn main() {");
  });

  it("embeds analysis ID and metadata in doc comments", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain(
      "//! Analysis ID: abc12345-6789-0000-0000-000000000000",
    );
    expect(script).toContain("//! Source file: subject01.edf");
    expect(script).toContain("//! Created:     2026-01-15T10:30:00.000Z");
  });

  it("embeds parameters as const declarations", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain(
      'const FILE_PATH: &str = "/data/recordings/subject01.edf"',
    );
    expect(script).toContain(
      'const CHANNELS: &[&str] = &["Fp1", "Fp2", "C3", "C4"]',
    );
    expect(script).toContain("const START_TIME: f64 = 0.0");
    expect(script).toContain("const END_TIME: f64 = 30.0");
    expect(script).toContain("const WINDOW_LENGTH: usize = 100");
    expect(script).toContain("const WINDOW_STEP: usize = 10");
    expect(script).toContain("const DELAYS: &[i32] = &[1, 2, 3, 4, 5]");
  });

  it("embeds optional parameters when present", () => {
    const result = makeResultWithOptionalParams();
    const script = generateRustScript(result);

    expect(script).toContain("const MODEL_DIMENSION: usize = 6");
    expect(script).toContain("const POLYNOMIAL_ORDER: usize = 5");
    expect(script).toContain("const NR_TAU: usize = 3");
  });

  it("omits optional parameters when absent", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).not.toContain("MODEL_DIMENSION");
    expect(script).not.toContain("POLYNOMIAL_ORDER");
    expect(script).not.toContain("NR_TAU");
  });

  it("defines DDAVariant struct", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("struct DDAVariant {");
    expect(script).toContain("variant_id: &'static str");
    expect(script).toContain("variant_name: &'static str");
    expect(script).toContain("channels: &'static [&'static str]");
    expect(script).toContain("dda_matrix: &'static [&'static [f64]]");
    expect(script).toContain("exponents: &'static [(&'static str, f64)]");
    expect(script).toContain("error_values: &'static [f64]");
  });

  it("embeds DDA matrix as static arrays of f64", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("SINGLE_TIMESERIES_FP1: &[f64] = &[");
    expect(script).toContain("SINGLE_TIMESERIES_FP2: &[f64] = &[");
    expect(script).toContain("SINGLE_TIMESERIES_C3: &[f64] = &[");
    expect(script).toContain("SINGLE_TIMESERIES_C4: &[f64] = &[");
    expect(script).toContain("SINGLE_TIMESERIES_MATRIX: &[&[f64]]");
  });

  it("embeds exponents as static tuples", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("SINGLE_TIMESERIES_EXPONENTS: &[(&str, f64)]");
    expect(script).toContain('"Fp1"');
    expect(script).toContain('"Fp2"');
  });

  it("embeds window indices as static f64 array", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("WINDOW_INDICES: &[f64]");
  });

  it("computes window indices when not provided", () => {
    const result = makeResultWithNoWindowIndices();
    const script = generateRustScript(result);

    expect(script).toContain("WINDOW_INDICES: &[f64] = &[0.0, 10.0, 20.0]");
  });

  it("handles NaN and Infinity values", () => {
    const result = makeResultWithNaN();
    const script = generateRustScript(result);

    expect(script).toContain("f64::NAN");
  });

  it("embeds error values when present", () => {
    const result = makeResultWithErrorValues();
    const script = generateRustScript(result);

    expect(script).toContain("SINGLE_TIMESERIES_ERRORS: &[f64] = &[");
    // Should contain actual values, not be empty
    expect(script).not.toContain("SINGLE_TIMESERIES_ERRORS: &[f64] = &[]");
  });

  it("creates empty error array when no error values", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("SINGLE_TIMESERIES_ERRORS: &[f64] = &[]");
  });

  it("filters to a single variant when specified", () => {
    const result = makeMultiVariantResult();
    const script = generateRustScript(result, {
      variant: "delay_embedding",
    });

    expect(script).toContain("DELAY_EMBEDDING");
    expect(script).not.toContain("SINGLE_TIMESERIES");
  });

  it("filters to specific channels when specified", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result, {
      channels: ["Fp1", "C3"],
    });

    expect(script).toContain("SINGLE_TIMESERIES_FP1");
    expect(script).toContain("SINGLE_TIMESERIES_C3");
    expect(script).not.toContain("SINGLE_TIMESERIES_FP2");
    expect(script).not.toContain("SINGLE_TIMESERIES_C4");
  });

  it("includes all variants when no filter", () => {
    const result = makeMultiVariantResult();
    const script = generateRustScript(result);

    expect(script).toContain("SINGLE_TIMESERIES");
    expect(script).toContain("DELAY_EMBEDDING");
    expect(script).toContain("ALL_VARIANTS: &[&DDAVariant]");
  });

  it("skips empty variants", () => {
    const result = makeEmptyVariantResult();
    const script = generateRustScript(result);

    expect(script).not.toContain("const EMPTY:");
    expect(script).toContain("SINGLE_TIMESERIES");
  });

  it("creates const DDAVariant instances", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain(
      "const SINGLE_TIMESERIES: DDAVariant = DDAVariant {",
    );
    expect(script).toContain('variant_id: "single_timeseries"');
    expect(script).toContain('variant_name: "Single Timeseries"');
  });

  it("includes a main() with summary output", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("fn main()");
    expect(script).toContain('println!("DDA Analysis: {}", FILE_PATH)');
    expect(script).toContain("variant.channels.len()");
    expect(script).toContain("variant.exponents");
  });

  it("handles variant IDs starting with digits", () => {
    const result = makeMinimalResult({
      results: {
        window_indices: [0, 10],
        variants: [
          {
            variant_id: "3channel_ct",
            variant_name: "3-Channel CT",
            dda_matrix: { Fp1: [0.5, 0.6] },
            exponents: {},
            quality_metrics: {},
          },
        ],
      },
    });
    const script = generateRustScript(result);

    // Should prefix with V since Rust identifiers can't start with digits
    expect(script).toContain("V3CHANNEL_CT");
  });

  it("properly escapes Rust strings", () => {
    const result = makeMinimalResult({
      file_path: '/data/path with "quotes"/file.edf',
    });
    const script = generateRustScript(result);

    expect(script).toContain('\\"quotes\\"');
  });

  it("uses 8 significant digits for precision", () => {
    const result = makeMinimalResult();
    result.results.variants[0].dda_matrix.Fp1 = [0.123456789012345];
    const script = generateRustScript(result);

    expect(script).toContain("0.12345679");
  });

  it("includes compile instruction in doc comment", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    expect(script).toContain("//! Compile and run: rustc");
  });
});

describe("getDefaultRustFilename", () => {
  it("generates filename with name, timestamp, and .rs extension", () => {
    const result = makeMinimalResult();
    const filename = getDefaultRustFilename(result);

    expect(filename).toMatch(
      /^dda_test_analysis_reproduce_2026-01-15T10-30-00\.rs$/,
    );
  });

  it("falls back to ID prefix when name is missing", () => {
    const result = makeMinimalResult({ name: undefined });
    const filename = getDefaultRustFilename(result);

    expect(filename).toMatch(/^dda_abc12345_reproduce_/);
    expect(filename).toMatch(/\.rs$/);
  });
});

// ---------------------------------------------------------------------------
// Cross-language consistency tests
// ---------------------------------------------------------------------------

describe("Cross-language consistency", () => {
  const result = makeMinimalResult();
  const pythonScript = generatePythonScript(result);
  const matlabScript = generateMatlabScript(result);
  const juliaScript = generateJuliaScript(result);
  const rustScript = generateRustScript(result);
  const allScripts = [pythonScript, matlabScript, juliaScript, rustScript];

  it("all languages embed the same analysis ID", () => {
    const id = "abc12345-6789-0000-0000-000000000000";
    for (const script of allScripts) {
      expect(script).toContain(id);
    }
  });

  it("all languages embed the same file path", () => {
    const path = "/data/recordings/subject01.edf";
    for (const script of allScripts) {
      expect(script).toContain(path);
    }
  });

  it("all languages embed all four channels", () => {
    for (const script of allScripts) {
      expect(script).toContain("Fp1");
      expect(script).toContain("Fp2");
      expect(script).toContain("C3");
      expect(script).toContain("C4");
    }
  });

  it("all languages embed the same delay list values", () => {
    for (const script of allScripts) {
      expect(script).toContain("1");
      expect(script).toContain("2");
      expect(script).toContain("3");
      expect(script).toContain("4");
      expect(script).toContain("5");
    }
  });

  it("all languages use 8-digit precision for DDA values", () => {
    const precisionResult = makeMinimalResult();
    precisionResult.results.variants[0].dda_matrix.Fp1 = [0.123456789012345];

    const py = generatePythonScript(precisionResult);
    const m = generateMatlabScript(precisionResult);
    const jl = generateJuliaScript(precisionResult);
    const rs = generateRustScript(precisionResult);

    // All should contain the same 8-sig-fig representation
    for (const script of [py, m, jl, rs]) {
      expect(script).toContain("0.12345679");
    }
  });

  it("all filenames use the same naming pattern", () => {
    const pyFilename = getDefaultPythonFilename(result);
    const mFilename = getDefaultMatlabFilename(result);
    const jlFilename = getDefaultJuliaFilename(result);
    const rsFilename = getDefaultRustFilename(result);

    const prefix = "dda_test_analysis_reproduce_2026-01-15T10-30-00";
    expect(pyFilename).toBe(`${prefix}.py`);
    expect(mFilename).toBe(`${prefix}.m`);
    expect(jlFilename).toBe(`${prefix}.jl`);
    expect(rsFilename).toBe(`${prefix}.rs`);
  });

  it("variant filtering produces consistent results across languages", () => {
    const multiResult = makeMultiVariantResult();
    const opts = { variant: "delay_embedding" as const };

    const pyFiltered = generatePythonScript(multiResult, opts);
    const mFiltered = generateMatlabScript(multiResult, opts);
    const jlFiltered = generateJuliaScript(multiResult, opts);
    const rsFiltered = generateRustScript(multiResult, opts);

    // All should include delay_embedding
    expect(pyFiltered).toContain("delay_embedding");
    expect(mFiltered).toContain("delay_embedding");
    expect(jlFiltered).toContain("delay_embedding");
    expect(rsFiltered).toContain("DELAY_EMBEDDING");

    // None should include single_timeseries data
    expect(pyFiltered).not.toContain('results["single_timeseries"]');
    expect(mFiltered).not.toContain("results.single_timeseries");
    expect(jlFiltered).not.toContain('results["single_timeseries"]');
    expect(rsFiltered).not.toContain("const SINGLE_TIMESERIES: DDAVariant");
  });

  it("channel filtering produces consistent results across languages", () => {
    const opts = { channels: ["Fp1"] };

    const pyFiltered = generatePythonScript(result, opts);
    const mFiltered = generateMatlabScript(result, opts);
    const jlFiltered = generateJuliaScript(result, opts);
    const rsFiltered = generateRustScript(result, opts);

    // All should include Fp1 data
    expect(pyFiltered).toContain("Fp1");
    expect(mFiltered).toContain("Fp1");
    expect(jlFiltered).toContain("Fp1");
    expect(rsFiltered).toContain("FP1");

    // None should include other channels in matrix data
    for (const script of [pyFiltered, jlFiltered]) {
      const matrixSection =
        script.split("DDA Results")[1]?.split("Window")[0] ?? "";
      expect(matrixSection).not.toContain('"Fp2"');
      expect(matrixSection).not.toContain('"C3"');
    }
    // MATLAB uses struct field with cell array
    expect(mFiltered).toContain("{'Fp1'}");
  });
});

// ---------------------------------------------------------------------------
// Data roundtrip equivalence tests
//
// These tests verify that the numerical data embedded in each generated script
// faithfully reproduces the source DDAResult. We extract numbers from the
// script text via regex and compare them against the input, ensuring that
// executing the script would yield the same values as the original analysis.
// ---------------------------------------------------------------------------

/** Extract all floating-point numbers from a text region */
function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+\.?\d*(?:e[+-]?\d+)?/gi) || [];
  return matches.map(Number).filter(Number.isFinite);
}

/** Compare two numbers at 8 significant digits (matching toPrecision(8)) */
function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  if (a === 0 || b === 0) return Math.abs(a - b) < 1e-7;
  const relErr = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
  return relErr < 5e-8; // toPrecision(8) gives ~8 sig figs
}

/**
 * Given a script and a regex that captures a bracketed array region for a
 * specific channel, extract the numbers and verify they match the source.
 */
function extractChannelArray(script: string, pattern: RegExp): number[] | null {
  const match = script.match(pattern);
  if (!match) return null;
  return extractNumbers(match[1]);
}

describe("Data roundtrip equivalence — Python", () => {
  it("DDA matrix values round-trip within 8-digit precision", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    for (const [ch, values] of Object.entries(
      result.results.variants[0].dda_matrix,
    )) {
      const pattern = new RegExp(`"${ch}":\\s*np\\.array\\(\\[([^\\]]+)\\]\\)`);
      const extracted = extractChannelArray(script, pattern);
      expect(extracted).not.toBeNull();
      expect(extracted!.length).toBe(values.length);
      for (let i = 0; i < values.length; i++) {
        expect(approxEqual(extracted![i], values[i])).toBe(true);
      }
    }
  });

  it("exponent values round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    for (const [ch, exp] of Object.entries(
      result.results.variants[0].exponents,
    )) {
      const pattern = new RegExp(`"${ch}":\\s*([\\d.]+)`);
      const match = script.match(pattern);
      expect(match).not.toBeNull();
      expect(approxEqual(Number(match![1]), exp)).toBe(true);
    }
  });

  it("window indices round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generatePythonScript(result);

    const match = script.match(
      /window_indices\s*=\s*np\.array\(\[([^\]]+)\]\)/,
    );
    expect(match).not.toBeNull();
    const extracted = extractNumbers(match![1]);
    expect(extracted).toEqual(result.results.window_indices);
  });

  it("error values round-trip within 8-digit precision", () => {
    const result = makeResultWithErrorValues();
    const script = generatePythonScript(result);

    const match = script.match(/"error_values":\s*np\.array\(\[([^\]]+)\]\)/);
    expect(match).not.toBeNull();
    const extracted = extractNumbers(match![1]);
    const source = result.results.error_values!;
    expect(extracted.length).toBe(source.length);
    for (let i = 0; i < source.length; i++) {
      expect(approxEqual(extracted[i], source[i])).toBe(true);
    }
  });

  it("NaN positions are preserved", () => {
    const result = makeResultWithNaN();
    const script = generatePythonScript(result);

    const match = script.match(/"Fp1":\s*np\.array\(\[([^\]]+)\]\)/);
    expect(match).not.toBeNull();
    const tokens = match![1].split(",").map((s) => s.trim());
    // Source: [0.5, NaN, 0.7]
    expect(Number(tokens[0])).toBeCloseTo(0.5);
    expect(tokens[1]).toBe("np.nan");
    expect(Number(tokens[2])).toBeCloseTo(0.7);
  });
});

describe("Data roundtrip equivalence — MATLAB", () => {
  it("DDA matrix values round-trip within 8-digit precision", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    // MATLAB embeds the matrix as rows separated by ;
    const matrixMatch = script.match(
      /results\.single_timeseries\.dda_matrix\s*=\s*\[([\s\S]*?)\];/,
    );
    expect(matrixMatch).not.toBeNull();

    const rows = matrixMatch![1].split(";").map((r) => r.trim());
    const channels = Object.keys(result.results.variants[0].dda_matrix);

    for (let r = 0; r < channels.length; r++) {
      const sourceValues = result.results.variants[0].dda_matrix[channels[r]];
      const extracted = extractNumbers(rows[r]);
      expect(extracted.length).toBe(sourceValues.length);
      for (let i = 0; i < sourceValues.length; i++) {
        expect(approxEqual(extracted[i], sourceValues[i])).toBe(true);
      }
    }
  });

  it("exponent values round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    const match = script.match(
      /results\.single_timeseries\.exponents\s*=\s*\[([^\]]+)\]/,
    );
    expect(match).not.toBeNull();
    const extracted = extractNumbers(match![1]);

    const channels = Object.keys(result.results.variants[0].dda_matrix);
    const sourceExponents = channels
      .map((ch) => result.results.variants[0].exponents[ch])
      .filter((v) => v !== undefined);

    expect(extracted.length).toBe(sourceExponents.length);
    for (let i = 0; i < sourceExponents.length; i++) {
      expect(approxEqual(extracted[i], sourceExponents[i])).toBe(true);
    }
  });

  it("window indices round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generateMatlabScript(result);

    const match = script.match(/window_indices\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const extracted = extractNumbers(match![1]);
    expect(extracted).toEqual(result.results.window_indices);
  });

  it("NaN positions are preserved", () => {
    const result = makeResultWithNaN();
    const script = generateMatlabScript(result);

    const matrixMatch = script.match(
      /results\.single_timeseries\.dda_matrix\s*=\s*\[([\s\S]*?)\];/,
    );
    expect(matrixMatch).not.toBeNull();

    const firstRow = matrixMatch![1].split(";")[0].trim();
    // Source Fp1: [0.5, NaN, 0.7]
    expect(firstRow).toContain("NaN");
    const tokens = firstRow.split(",").map((s) => s.trim());
    expect(Number(tokens[0])).toBeCloseTo(0.5);
    expect(tokens[1]).toBe("NaN");
    expect(Number(tokens[2])).toBeCloseTo(0.7);
  });
});

describe("Data roundtrip equivalence — Julia", () => {
  it("DDA matrix values round-trip within 8-digit precision", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    for (const [ch, values] of Object.entries(
      result.results.variants[0].dda_matrix,
    )) {
      const pattern = new RegExp(`"${ch}"\\s*=>\\s*\\[([^\\]]+)\\]`);
      const extracted = extractChannelArray(script, pattern);
      expect(extracted).not.toBeNull();
      expect(extracted!.length).toBe(values.length);
      for (let i = 0; i < values.length; i++) {
        expect(approxEqual(extracted![i], values[i])).toBe(true);
      }
    }
  });

  it("exponent values round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    for (const [ch, exp] of Object.entries(
      result.results.variants[0].exponents,
    )) {
      const pattern = new RegExp(`"${ch}"\\s*=>\\s*([\\d.]+)`);
      const match = script.match(pattern);
      expect(match).not.toBeNull();
      expect(approxEqual(Number(match![1]), exp)).toBe(true);
    }
  });

  it("window indices round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generateJuliaScript(result);

    const match = script.match(/window_indices\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const extracted = extractNumbers(match![1]);
    expect(extracted).toEqual(result.results.window_indices);
  });

  it("NaN positions are preserved", () => {
    const result = makeResultWithNaN();
    const script = generateJuliaScript(result);

    const match = script.match(/"Fp1"\s*=>\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const tokens = match![1].split(",").map((s) => s.trim());
    expect(Number(tokens[0])).toBeCloseTo(0.5);
    expect(tokens[1]).toBe("NaN");
    expect(Number(tokens[2])).toBeCloseTo(0.7);
  });
});

describe("Data roundtrip equivalence — Rust", () => {
  it("DDA matrix values round-trip within 8-digit precision", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    for (const [ch, values] of Object.entries(
      result.results.variants[0].dda_matrix,
    )) {
      const rustCh = ch.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      const pattern = new RegExp(
        `SINGLE_TIMESERIES_${rustCh}:\\s*&\\[f64\\]\\s*=\\s*&\\[([^\\]]+)\\]`,
      );
      const extracted = extractChannelArray(script, pattern);
      expect(extracted).not.toBeNull();
      expect(extracted!.length).toBe(values.length);
      for (let i = 0; i < values.length; i++) {
        expect(approxEqual(extracted![i], values[i])).toBe(true);
      }
    }
  });

  it("exponent values round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    for (const [ch, exp] of Object.entries(
      result.results.variants[0].exponents,
    )) {
      const pattern = new RegExp(`\\("${ch}",\\s*([\\d.e+-]+)\\)`);
      const match = script.match(pattern);
      expect(match).not.toBeNull();
      expect(approxEqual(Number(match![1]), exp)).toBe(true);
    }
  });

  it("window indices round-trip exactly", () => {
    const result = makeMinimalResult();
    const script = generateRustScript(result);

    const match = script.match(
      /WINDOW_INDICES:\s*&\[f64\]\s*=\s*&\[([^\]]+)\]/,
    );
    expect(match).not.toBeNull();
    const extracted = extractNumbers(match![1]);
    expect(extracted.length).toBe(result.results.window_indices.length);
    for (let i = 0; i < result.results.window_indices.length; i++) {
      expect(approxEqual(extracted[i], result.results.window_indices[i])).toBe(
        true,
      );
    }
  });

  it("NaN positions are preserved", () => {
    const result = makeResultWithNaN();
    const script = generateRustScript(result);

    const match = script.match(
      /SINGLE_TIMESERIES_FP1:\s*&\[f64\]\s*=\s*&\[([^\]]+)\]/,
    );
    expect(match).not.toBeNull();
    const tokens = match![1].split(",").map((s) => s.trim());
    // Source: [0.5, NaN, 0.7]
    expect(Number(tokens[0])).toBeCloseTo(0.5);
    expect(tokens[1]).toBe("f64::NAN");
    expect(Number(tokens[2])).toBeCloseTo(0.7);
  });
});

describe("Data roundtrip equivalence — multi-variant with challenging values", () => {
  function makeHighPrecisionResult(): DDAResult {
    return makeMinimalResult({
      results: {
        window_indices: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
        variants: [
          {
            variant_id: "single_timeseries",
            variant_name: "Single Timeseries",
            dda_matrix: {
              Fp1: [
                0.00012345678, 1.2345678e-10, 9876543.2, -0.001, 0.0, 1e15,
                -1e-15, 3.1415926535, 2.7182818284, 0.99999999,
              ],
              Fp2: [
                100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0, 800.0, 900.0,
                1000.0,
              ],
            },
            exponents: {
              Fp1: 1.23456789,
              Fp2: -0.98765432,
            },
            quality_metrics: {},
            error_values: [
              0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009,
              0.01,
            ],
          },
        ],
      },
    });
  }

  it("all languages preserve high-precision DDA values for Fp1", () => {
    const result = makeHighPrecisionResult();
    const source = result.results.variants[0].dda_matrix.Fp1;

    const py = generatePythonScript(result);
    const m = generateMatlabScript(result);
    const jl = generateJuliaScript(result);
    const rs = generateRustScript(result);

    // Python
    const pyMatch = py.match(/"Fp1":\s*np\.array\(\[([^\]]+)\]\)/);
    expect(pyMatch).not.toBeNull();
    const pyNums = pyMatch![1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "np.nan")
      .map(Number)
      .filter(Number.isFinite);

    // Julia
    const jlMatch = jl.match(/"Fp1"\s*=>\s*\[([^\]]+)\]/);
    expect(jlMatch).not.toBeNull();
    const jlNums = jlMatch![1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "NaN")
      .map(Number)
      .filter(Number.isFinite);

    // Rust
    const rsMatch = rs.match(
      /SINGLE_TIMESERIES_FP1:\s*&\[f64\]\s*=\s*&\[([^\]]+)\]/,
    );
    expect(rsMatch).not.toBeNull();
    const rsNums = rsMatch![1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "f64::NAN")
      .map(Number)
      .filter(Number.isFinite);

    // MATLAB — extract from 2D matrix first row
    const mMatch = m.match(
      /results\.single_timeseries\.dda_matrix\s*=\s*\[([\s\S]*?)\];/,
    );
    expect(mMatch).not.toBeNull();
    const mFirstRow = mMatch![1].split(";")[0].trim();
    const mNums = mFirstRow
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "NaN")
      .map(Number)
      .filter(Number.isFinite);

    // All finite source values should be present in each language
    const finiteSource = source.filter(Number.isFinite);
    for (const nums of [pyNums, mNums, jlNums, rsNums]) {
      expect(nums.length).toBe(finiteSource.length);
      for (let i = 0; i < finiteSource.length; i++) {
        expect(approxEqual(nums[i], finiteSource[i])).toBe(true);
      }
    }
  });

  it("all languages preserve error values identically", () => {
    const result = makeHighPrecisionResult();
    const source = result.results.variants[0].error_values!;

    const py = generatePythonScript(result);
    const m = generateMatlabScript(result);
    const jl = generateJuliaScript(result);
    const rs = generateRustScript(result);

    // Python
    const pyMatch = py.match(/"error_values":\s*np\.array\(\[([^\]]+)\]\)/);
    expect(pyMatch).not.toBeNull();
    const pyNums = extractNumbers(pyMatch![1]);

    // MATLAB
    const mMatch = m.match(
      /results\.single_timeseries\.error_values\s*=\s*\[([^\]]+)\]/,
    );
    expect(mMatch).not.toBeNull();
    const mNums = extractNumbers(mMatch![1]);

    // Julia
    const jlMatch = jl.match(/"error_values"\s*=>\s*\[([^\]]+)\]/);
    expect(jlMatch).not.toBeNull();
    const jlNums = extractNumbers(jlMatch![1]);

    // Rust
    const rsMatch = rs.match(
      /SINGLE_TIMESERIES_ERRORS:\s*&\[f64\]\s*=\s*&\[([^\]]+)\]/,
    );
    expect(rsMatch).not.toBeNull();
    const rsNums = extractNumbers(rsMatch![1]);

    for (const nums of [pyNums, mNums, jlNums, rsNums]) {
      expect(nums.length).toBe(source.length);
      for (let i = 0; i < source.length; i++) {
        expect(approxEqual(nums[i], source[i])).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Empty results guards
// ---------------------------------------------------------------------------

function makeAllEmptyVariantResult(): DDAResult {
  return makeMinimalResult({
    results: {
      window_indices: [],
      variants: [
        {
          variant_id: "single_timeseries",
          variant_name: "Single Timeseries",
          dda_matrix: {},
          exponents: {},
          quality_metrics: {},
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Heatmap generation contract tests
//
// These verify the data invariants that each language's plot_dda_heatmap
// function depends on. A violation of any invariant means the generated
// script will crash at runtime — exactly the bug we shipped.
//
// Contracts tested:
//   C1. results is populated iff variants have dda_matrix data
//   C2. every variant_id in results is a key the plot function can look up
//   C3. window_indices is non-empty when results has data
//   C4. window_indices length == matrix row length (channels × windows)
//   C5. all channels within a variant share the same array length
//   C6. empty-results guard precedes first key/field access
//   C7. main-block iteration is safe for every data shape
// ---------------------------------------------------------------------------

// --- Helpers for extracting structure from generated scripts ---

/** Extract Python results dict keys: results["key"] = { */
function extractPythonResultKeys(script: string): string[] {
  const matches = script.matchAll(/^results\["([^"]+)"\]\s*=\s*\{/gm);
  return [...matches].map((m) => m[1]);
}

/** Extract Python np.array lengths per channel inside a variant block */
function extractPythonChannelLengths(
  script: string,
  variantId: string,
): Map<string, number> {
  const map = new Map<string, number>();
  // Find the variant block: results["id"] = { ... }
  const blockRe = new RegExp(
    `results\\["${variantId}"\\]\\s*=\\s*\\{([\\s\\S]*?)^\\}`,
    "m",
  );
  const blockMatch = script.match(blockRe);
  if (!blockMatch) return map;
  const block = blockMatch[1];
  // Each channel: "Ch": np.array([...])
  const chanRe = /"([^"]+)":\s*np\.array\(\[([^\]]*)\]\)/g;
  for (const m of block.matchAll(chanRe)) {
    // Only inside "dda_matrix" context (skip exponents etc.)
    const nums = m[2].split(",").filter((s) => s.trim().length > 0);
    map.set(m[1], nums.length);
  }
  return map;
}

/** Extract Python window_indices length */
function extractPythonWindowIndicesLength(script: string): number | null {
  // Case 1: np.array([1, 2, 3, ...])
  const arrayMatch = script.match(
    /^window_indices\s*=\s*np\.array\(\[([^\]]*)\]\)/m,
  );
  if (arrayMatch) {
    const items = arrayMatch[1].split(",").filter((s) => s.trim().length > 0);
    return items.length;
  }
  // Case 2: np.arange(0, N * step, step) → length = N
  const arangeMatch = script.match(
    /^window_indices\s*=\s*np\.arange\((\d+),\s*(\d+)\s*\*\s*(\d+),\s*(\d+)\)/m,
  );
  if (arangeMatch) {
    const start = Number(arangeMatch[1]);
    const count = Number(arangeMatch[2]);
    const step = Number(arangeMatch[3]);
    return count === 0 ? 0 : Math.ceil((count * step - start) / step);
  }
  return null;
}

/** Extract MATLAB results struct field names: results.FIELD.variant_name */
function extractMatlabResultFields(script: string): string[] {
  const matches = script.matchAll(/^results\.(\w+)\.variant_name\s*=/gm);
  return [...matches].map((m) => m[1]);
}

/** Extract MATLAB dda_matrix row count and column count for a field */
function extractMatlabMatrixShape(
  script: string,
  field: string,
): { rows: number; cols: number } | null {
  const re = new RegExp(
    `results\\.${field}\\.dda_matrix\\s*=\\s*\\[([\\s\\S]*?)\\];`,
  );
  const match = script.match(re);
  if (!match) return null;
  const rows = match[1]
    .split(";")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (rows.length === 0) return { rows: 0, cols: 0 };
  const cols = rows[0].split(",").filter((s) => s.trim().length > 0).length;
  return { rows: rows.length, cols };
}

/** Extract MATLAB window_indices length */
function extractMatlabWindowIndicesLength(script: string): number | null {
  // Case 1: window_indices = [1, 2, 3];
  const arrayMatch = script.match(/^window_indices\s*=\s*\[([^\]]*)\];/m);
  if (arrayMatch) {
    const items = arrayMatch[1].split(",").filter((s) => s.trim().length > 0);
    return items.length;
  }
  // Case 2: window_indices = 0:step:max;
  const rangeMatch = script.match(
    /^window_indices\s*=\s*(\d+):(\d+):(-?\d+);/m,
  );
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const step = Number(rangeMatch[2]);
    const stop = Number(rangeMatch[3]);
    if (stop < start) return 0;
    return Math.floor((stop - start) / step) + 1;
  }
  return null;
}

/** Extract Julia results dict keys */
function extractJuliaResultKeys(script: string): string[] {
  const matches = script.matchAll(
    /^results\["([^"]+)"\]\s*=\s*Dict\{String,\s*Any\}\(/gm,
  );
  return [...matches].map((m) => m[1]);
}

/** Extract Julia channel array lengths for a variant */
function extractJuliaChannelLengths(
  script: string,
  variantId: string,
): Map<string, number> {
  const map = new Map<string, number>();
  // Find the dda_matrix Dict block for this variant
  const blockRe = new RegExp(
    `results\\["${variantId}"\\]\\s*=\\s*Dict\\{String,\\s*Any\\}\\(([\\s\\S]*?)^\\)`,
    "m",
  );
  const blockMatch = script.match(blockRe);
  if (!blockMatch) return map;
  // Inside the dda_matrix Dict
  const matrixRe =
    /"dda_matrix"\s*=>\s*Dict\{String,\s*Vector\{Float64\}\}\(([\s\S]*?)\),/;
  const matrixMatch = blockMatch[1].match(matrixRe);
  if (!matrixMatch) return map;
  const chanRe = /"([^"]+)"\s*=>\s*\[([^\]]*)\]/g;
  for (const m of matrixMatch[1].matchAll(chanRe)) {
    const nums = m[2].split(",").filter((s) => s.trim().length > 0);
    map.set(m[1], nums.length);
  }
  return map;
}

/** Extract Julia window_indices length */
function extractJuliaWindowIndicesLength(script: string): number | null {
  // Case 1: window_indices = [0, 10, 20]
  const arrayMatch = script.match(/^window_indices\s*=\s*\[([^\]]*)\]/m);
  if (arrayMatch) {
    const items = arrayMatch[1].split(",").filter((s) => s.trim().length > 0);
    return items.length;
  }
  // Case 2: collect(0:step:max)
  const collectMatch = script.match(
    /^window_indices\s*=\s*collect\((\d+):(\d+):(-?\d+)\)/m,
  );
  if (collectMatch) {
    const start = Number(collectMatch[1]);
    const step = Number(collectMatch[2]);
    const stop = Number(collectMatch[3]);
    if (stop < start) return 0;
    return Math.floor((stop - start) / step) + 1;
  }
  return null;
}

/** Extract Rust variant IDs from ALL_VARIANTS references */
function extractRustVariantIds(script: string): string[] {
  const match = script.match(
    /const ALL_VARIANTS:\s*&\[&DDAVariant\]\s*=\s*&\[([^\]]*)\]/,
  );
  if (!match || match[1].trim() === "") return [];
  return match[1].split(",").map((s) => s.trim().replace(/^&/, ""));
}

/** Extract Rust channel array length for a variant's channel */
function extractRustChannelLengths(
  script: string,
  variantId: string,
): Map<string, number> {
  const map = new Map<string, number>();
  const safeId = variantId.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  // Match: SAFEID_CHANNEL: &[f64] = &[...]
  const chanRe = new RegExp(
    `const ${safeId}_(\\w+):\\s*&\\[f64\\]\\s*=\\s*&\\[([^\\]]*)\\]`,
    "g",
  );
  for (const m of script.matchAll(chanRe)) {
    const name = m[1];
    // Skip known non-channel arrays
    if (name === "ERRORS") continue;
    const items = m[2].split(",").filter((s) => s.trim().length > 0);
    map.set(name, items.length);
  }
  return map;
}

/** Extract Rust WINDOW_INDICES length */
function extractRustWindowIndicesLength(script: string): number | null {
  const match = script.match(
    /const WINDOW_INDICES:\s*&\[f64\]\s*=\s*&\[([^\]]*)\]/,
  );
  if (!match) return null;
  if (match[1].trim() === "") return 0;
  return match[1].split(",").filter((s) => s.trim().length > 0).length;
}

// --- The test fixtures ---

const heatmapFixtures = [
  { name: "single variant", make: makeMinimalResult },
  { name: "multi variant", make: makeMultiVariantResult },
  { name: "NaN/Infinity values", make: makeResultWithNaN },
  { name: "with error values", make: makeResultWithErrorValues },
  { name: "no explicit window_indices", make: makeResultWithNoWindowIndices },
  { name: "mixed empty + populated variants", make: makeEmptyVariantResult },
];

// --- Contract tests: Python ---

describe("Heatmap contracts — Python", () => {
  describe("C1: results populated iff variants have data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generatePythonScript(result);
        const keys = extractPythonResultKeys(script);
        const expectedCount = result.results.variants.filter(
          (v) => Object.keys(v.dda_matrix).length > 0,
        ).length;
        expect(keys.length).toBe(expectedCount);
      });
    }

    it("all-empty variants → results dict has zero entries", () => {
      const script = generatePythonScript(makeAllEmptyVariantResult());
      expect(extractPythonResultKeys(script).length).toBe(0);
    });
  });

  describe("C2: every variant_id in results is a valid key", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generatePythonScript(result);
        const keys = extractPythonResultKeys(script);
        const expectedIds = result.results.variants
          .filter((v) => Object.keys(v.dda_matrix).length > 0)
          .map((v) => v.variant_id);
        expect(keys).toEqual(expectedIds);
      });
    }
  });

  describe("C3: window_indices non-empty when results has data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generatePythonScript(result);
        const keys = extractPythonResultKeys(script);
        const wiLen = extractPythonWindowIndicesLength(script);
        if (keys.length > 0) {
          expect(wiLen).not.toBeNull();
          expect(wiLen).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("C4: window_indices length matches matrix row length", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generatePythonScript(result);
        const keys = extractPythonResultKeys(script);
        const wiLen = extractPythonWindowIndicesLength(script);
        for (const vid of keys) {
          const chanLens = extractPythonChannelLengths(script, vid);
          for (const [, len] of chanLens) {
            expect(len).toBe(wiLen);
          }
        }
      });
    }
  });

  describe("C5: all channels within a variant share the same array length", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generatePythonScript(result);
        const keys = extractPythonResultKeys(script);
        for (const vid of keys) {
          const chanLens = extractPythonChannelLengths(script, vid);
          const lengths = [...chanLens.values()];
          if (lengths.length > 0) {
            expect(new Set(lengths).size).toBe(1);
          }
        }
      });
    }
  });

  describe("C6: empty-results guard precedes first key access", () => {
    it("guard comes before list(results.keys())[0]", () => {
      const script = generatePythonScript(makeMinimalResult());
      const guardPos = script.indexOf("if not results:");
      const accessPos = script.indexOf("list(results.keys())[0]");
      expect(guardPos).toBeGreaterThan(-1);
      expect(accessPos).toBeGreaterThan(-1);
      expect(guardPos).toBeLessThan(accessPos);
    });

    it("main block guard comes before results.items() iteration", () => {
      const script = generatePythonScript(makeMinimalResult());
      const mainGuardPos = script.indexOf(
        'print("\\nWarning: No variant results embedded',
      );
      const iterPos = script.indexOf("for vid, vdata in results.items():");
      expect(mainGuardPos).toBeGreaterThan(-1);
      expect(iterPos).toBeGreaterThan(-1);
      expect(mainGuardPos).toBeLessThan(iterPos);
    });
  });

  describe("C7: main block iteration safe for every data shape", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}: next(iter(...)) guarded or dict non-empty`, () => {
        const result = make();
        const script = generatePythonScript(result);
        const keys = extractPythonResultKeys(script);
        if (keys.length === 0) {
          // Main block should not reach next(iter(...))
          expect(script).toContain("if not results:");
        } else {
          // next(iter()) should have a guard: `if vdata["dda_matrix"] else 0`
          expect(script).toContain('if vdata["dda_matrix"] else 0');
        }
      });
    }
  });
});

// --- Contract tests: MATLAB ---

describe("Heatmap contracts — MATLAB", () => {
  describe("C1: results populated iff variants have data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateMatlabScript(result);
        const fields = extractMatlabResultFields(script);
        const expectedCount = result.results.variants.filter(
          (v) => Object.keys(v.dda_matrix).length > 0,
        ).length;
        expect(fields.length).toBe(expectedCount);
      });
    }
  });

  describe("C3: window_indices non-empty when results has data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateMatlabScript(result);
        const fields = extractMatlabResultFields(script);
        const wiLen = extractMatlabWindowIndicesLength(script);
        if (fields.length > 0) {
          expect(wiLen).not.toBeNull();
          expect(wiLen).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("C4: window_indices length matches matrix column count", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateMatlabScript(result);
        const fields = extractMatlabResultFields(script);
        const wiLen = extractMatlabWindowIndicesLength(script);
        for (const field of fields) {
          const shape = extractMatlabMatrixShape(script, field);
          if (shape && shape.cols > 0) {
            expect(shape.cols).toBe(wiLen);
          }
        }
      });
    }
  });

  describe("C5: all matrix rows same length (rectangular matrix)", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateMatlabScript(result);
        const fields = extractMatlabResultFields(script);
        for (const field of fields) {
          const re = new RegExp(
            `results\\.${field}\\.dda_matrix\\s*=\\s*\\[([\\s\\S]*?)\\];`,
          );
          const match = script.match(re);
          if (match) {
            const rows = match[1]
              .split(";")
              .map((r) => r.trim())
              .filter((r) => r.length > 0);
            const colCounts = rows.map(
              (r) => r.split(",").filter((s) => s.trim().length > 0).length,
            );
            if (colCounts.length > 1) {
              expect(new Set(colCounts).size).toBe(1);
            }
          }
        }
      });
    }
  });

  describe("C6: empty-results guard precedes first field access", () => {
    it("guard comes before fields{1} in plot function", () => {
      const script = generateMatlabScript(makeMinimalResult());
      const guardPos = script.indexOf("isempty(fieldnames(results))");
      const accessPos = script.indexOf("variant_field = fields{1}");
      expect(guardPos).toBeGreaterThan(-1);
      expect(accessPos).toBeGreaterThan(-1);
      expect(guardPos).toBeLessThan(accessPos);
    });
  });
});

// --- Contract tests: Julia ---

describe("Heatmap contracts — Julia", () => {
  describe("C1: results populated iff variants have data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateJuliaScript(result);
        const keys = extractJuliaResultKeys(script);
        const expectedCount = result.results.variants.filter(
          (v) => Object.keys(v.dda_matrix).length > 0,
        ).length;
        expect(keys.length).toBe(expectedCount);
      });
    }
  });

  describe("C3: window_indices non-empty when results has data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateJuliaScript(result);
        const keys = extractJuliaResultKeys(script);
        const wiLen = extractJuliaWindowIndicesLength(script);
        if (keys.length > 0) {
          expect(wiLen).not.toBeNull();
          expect(wiLen).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("C4: window_indices length matches matrix row length", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateJuliaScript(result);
        const keys = extractJuliaResultKeys(script);
        const wiLen = extractJuliaWindowIndicesLength(script);
        for (const vid of keys) {
          const chanLens = extractJuliaChannelLengths(script, vid);
          for (const [, len] of chanLens) {
            expect(len).toBe(wiLen);
          }
        }
      });
    }
  });

  describe("C5: all channels within a variant share the same array length", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateJuliaScript(result);
        const keys = extractJuliaResultKeys(script);
        for (const vid of keys) {
          const chanLens = extractJuliaChannelLengths(script, vid);
          const lengths = [...chanLens.values()];
          if (lengths.length > 0) {
            expect(new Set(lengths).size).toBe(1);
          }
        }
      });
    }
  });

  describe("C6: empty-results guard precedes first key access", () => {
    it("guard comes before first(keys(results))", () => {
      const script = generateJuliaScript(makeMinimalResult());
      const guardPos = script.indexOf("isempty(results)");
      const accessPos = script.indexOf("first(keys(results))");
      expect(guardPos).toBeGreaterThan(-1);
      expect(accessPos).toBeGreaterThan(-1);
      expect(guardPos).toBeLessThan(accessPos);
    });
  });
});

// --- Contract tests: Rust ---

describe("Heatmap contracts — Rust", () => {
  describe("C1: variants populated iff variants have data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateRustScript(result);
        const ids = extractRustVariantIds(script);
        const expectedCount = result.results.variants.filter(
          (v) => Object.keys(v.dda_matrix).length > 0,
        ).length;
        expect(ids.length).toBe(expectedCount);
      });
    }
  });

  describe("C3: WINDOW_INDICES non-empty when ALL_VARIANTS has data", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateRustScript(result);
        const ids = extractRustVariantIds(script);
        const wiLen = extractRustWindowIndicesLength(script);
        if (ids.length > 0) {
          expect(wiLen).not.toBeNull();
          expect(wiLen).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("C4: WINDOW_INDICES length matches channel array length", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateRustScript(result);
        const ids = extractRustVariantIds(script);
        const wiLen = extractRustWindowIndicesLength(script);
        for (const id of ids) {
          const chanLens = extractRustChannelLengths(script, id);
          for (const [, len] of chanLens) {
            expect(len).toBe(wiLen);
          }
        }
      });
    }
  });

  describe("C5: all channels within a variant share the same array length", () => {
    for (const { name, make } of heatmapFixtures) {
      it(`${name}`, () => {
        const result = make();
        const script = generateRustScript(result);
        const ids = extractRustVariantIds(script);
        for (const id of ids) {
          const chanLens = extractRustChannelLengths(script, id);
          const lengths = [...chanLens.values()];
          if (lengths.length > 0) {
            expect(new Set(lengths).size).toBe(1);
          }
        }
      });
    }
  });

  describe("C6: empty guard precedes iteration", () => {
    it("ALL_VARIANTS.is_empty() check comes before for loop", () => {
      const script = generateRustScript(makeMinimalResult());
      const guardPos = script.indexOf("ALL_VARIANTS.is_empty()");
      const loopPos = script.indexOf("for variant in ALL_VARIANTS");
      expect(guardPos).toBeGreaterThan(-1);
      expect(loopPos).toBeGreaterThan(-1);
      expect(guardPos).toBeLessThan(loopPos);
    });
  });
});
