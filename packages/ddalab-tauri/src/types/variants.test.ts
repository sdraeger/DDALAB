/**
 * Comprehensive spec validation tests for generated TypeScript variants module.
 *
 * These tests validate that the generated DDA spec implementation is correct and consistent.
 */

import { describe, it, expect } from "vitest";
import {
  SPEC_VERSION,
  SELECT_MASK_SIZE,
  BINARY_NAME,
  REQUIRES_SHELL_WRAPPER,
  SHELL_COMMAND,
  SUPPORTED_PLATFORMS,
  ST,
  CT,
  CD,
  RESERVED,
  DE,
  SY,
  VARIANT_REGISTRY,
  VARIANT_ORDER,
  SELECT_MASK_POSITIONS,
  FILE_TYPES,
  getVariantByAbbrev,
  getVariantBySuffix,
  getVariantByPosition,
  getActiveVariants,
  isVariantAbbreviation,
  generateSelectMask,
  parseSelectMask,
  formatSelectMask,
  requiresCtParams,
  getFileTypeFromExtension,
  generateDelays,
  DEFAULT_SCALE_PARAMETERS,
  type VariantMetadata,
  type VariantAbbreviation,
} from "./variants";

// Expected configurations - canonical source of truth for tests
const EXPECTED_VARIANTS: [string, number, string, number, boolean][] = [
  // [abbreviation, position, output_suffix, stride, reserved]
  ["ST", 0, "_ST", 4, false],
  ["CT", 1, "_CT", 4, false],
  ["CD", 2, "_CD_DDA_ST", 2, false],
  ["RESERVED", 3, "_RESERVED", 1, true],
  ["DE", 4, "_DE", 1, false],
  ["SY", 5, "_SY", 1, false],
];

const ACTIVE_VARIANT_ABBREVS = ["ST", "CT", "CD", "DE", "SY"];
const CT_REQUIRING_VARIANTS = ["CT", "CD", "DE"];

// =============================================================================
// CONSTANT VALIDATION
// =============================================================================

describe("Constants", () => {
  it("should have correct spec version", () => {
    expect(SPEC_VERSION).toBe("1.0.0");
  });

  it("should have correct binary name", () => {
    expect(BINARY_NAME).toBe("run_DDA_AsciiEdf");
  });

  it("should require shell wrapper", () => {
    expect(REQUIRES_SHELL_WRAPPER).toBe(true);
  });

  it("should have correct shell command", () => {
    expect(SHELL_COMMAND).toBe("sh");
  });

  it("should have correct supported platforms", () => {
    expect(SUPPORTED_PLATFORMS).toContain("linux");
    expect(SUPPORTED_PLATFORMS).toContain("macos");
    expect(SUPPORTED_PLATFORMS).toContain("windows");
    expect(SUPPORTED_PLATFORMS).toHaveLength(3);
  });

  it("should have correct select mask size", () => {
    expect(SELECT_MASK_SIZE).toBe(6);
    expect(VARIANT_REGISTRY).toHaveLength(SELECT_MASK_SIZE);
  });
});

// =============================================================================
// VARIANT METADATA VALIDATION
// =============================================================================

describe("Variant Metadata", () => {
  it("should have all variants present", () => {
    expect(VARIANT_REGISTRY).toHaveLength(EXPECTED_VARIANTS.length);

    for (const [abbrev, pos, suffix, stride, reserved] of EXPECTED_VARIANTS) {
      const variant = getVariantByAbbrev(abbrev);
      expect(variant).toBeDefined();
      expect(variant!.position).toBe(pos);
      expect(variant!.outputSuffix).toBe(suffix);
      expect(variant!.stride).toBe(stride);
      expect(variant!.reserved).toBe(reserved);
    }
  });

  it("should have unique variant positions", () => {
    const positions = VARIANT_REGISTRY.map((v) => v.position);
    const uniquePositions = new Set(positions);
    expect(uniquePositions.size).toBe(positions.length);
  });

  it("should have sequential variant positions", () => {
    VARIANT_REGISTRY.forEach((variant, i) => {
      expect(variant.position).toBe(i);
    });
  });

  it("should have unique variant abbreviations", () => {
    const abbrevs = VARIANT_REGISTRY.map((v) => v.abbreviation);
    const uniqueAbbrevs = new Set(abbrevs);
    expect(uniqueAbbrevs.size).toBe(abbrevs.length);
  });

  it("should have unique variant output suffixes", () => {
    const suffixes = VARIANT_REGISTRY.map((v) => v.outputSuffix);
    const uniqueSuffixes = new Set(suffixes);
    expect(uniqueSuffixes.size).toBe(suffixes.length);
  });

  it("should only have RESERVED as reserved", () => {
    for (const variant of VARIANT_REGISTRY) {
      if (variant.abbreviation === "RESERVED") {
        expect(variant.reserved).toBe(true);
      } else {
        expect(variant.reserved).toBe(false);
      }
    }
  });
});

// =============================================================================
// STRIDE VALUES
// =============================================================================

describe("Stride Values", () => {
  it("ST should have stride 4", () => {
    expect(ST.stride).toBe(4);
  });

  it("CT should have stride 4", () => {
    expect(CT.stride).toBe(4);
  });

  it("CD should have stride 2", () => {
    expect(CD.stride).toBe(2);
  });

  it("DE should have stride 1", () => {
    expect(DE.stride).toBe(1);
  });

  it("SY should have stride 1", () => {
    expect(SY.stride).toBe(1);
  });
});

// =============================================================================
// OUTPUT COLUMNS
// =============================================================================

describe("Output Columns", () => {
  it("ST should have 3 coefficients and error", () => {
    expect(ST.outputColumns.coefficients).toBe(3);
    expect(ST.outputColumns.hasError).toBe(true);
  });

  it("CT should have 3 coefficients and error", () => {
    expect(CT.outputColumns.coefficients).toBe(3);
    expect(CT.outputColumns.hasError).toBe(true);
  });

  it("CD should have 1 coefficient and error", () => {
    expect(CD.outputColumns.coefficients).toBe(1);
    expect(CD.outputColumns.hasError).toBe(true);
  });

  it("DE should have 0 coefficients and no error", () => {
    expect(DE.outputColumns.coefficients).toBe(0);
    expect(DE.outputColumns.hasError).toBe(false);
  });

  it("SY should have 0 coefficients and no error", () => {
    expect(SY.outputColumns.coefficients).toBe(0);
    expect(SY.outputColumns.hasError).toBe(false);
  });
});

// =============================================================================
// CHANNEL FORMAT
// =============================================================================

describe("Channel Format", () => {
  it("ST should use individual channel format", () => {
    expect(ST.channelFormat).toBe("individual");
  });

  it("CT should use pairs channel format", () => {
    expect(CT.channelFormat).toBe("pairs");
  });

  it("CD should use directed_pairs channel format", () => {
    expect(CD.channelFormat).toBe("directed_pairs");
  });

  it("DE should use individual channel format", () => {
    expect(DE.channelFormat).toBe("individual");
  });

  it("SY should use individual channel format", () => {
    expect(SY.channelFormat).toBe("individual");
  });
});

// =============================================================================
// REQUIRED PARAMETERS
// =============================================================================

describe("Required Parameters", () => {
  it("CT should require CT params", () => {
    expect(requiresCtParams(CT)).toBe(true);
    expect(CT.requiredParams).toContain("-WL_CT");
    expect(CT.requiredParams).toContain("-WS_CT");
  });

  it("CD should require CT params", () => {
    expect(requiresCtParams(CD)).toBe(true);
    expect(CD.requiredParams).toContain("-WL_CT");
    expect(CD.requiredParams).toContain("-WS_CT");
  });

  it("DE should require CT params", () => {
    expect(requiresCtParams(DE)).toBe(true);
    expect(DE.requiredParams).toContain("-WL_CT");
    expect(DE.requiredParams).toContain("-WS_CT");
  });

  it("ST should not require CT params", () => {
    expect(requiresCtParams(ST)).toBe(false);
    expect(ST.requiredParams).toHaveLength(0);
  });

  it("SY should not require CT params", () => {
    expect(requiresCtParams(SY)).toBe(false);
    expect(SY.requiredParams).toHaveLength(0);
  });
});

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

describe("Lookup Functions", () => {
  describe("getVariantByAbbrev", () => {
    it("should find all variants by abbreviation", () => {
      for (const [abbrev] of EXPECTED_VARIANTS) {
        expect(getVariantByAbbrev(abbrev)).toBeDefined();
      }
    });

    it("should return undefined for invalid abbreviation", () => {
      expect(getVariantByAbbrev("XX")).toBeUndefined();
      expect(getVariantByAbbrev("")).toBeUndefined();
      expect(getVariantByAbbrev("st")).toBeUndefined(); // Case sensitive
    });
  });

  describe("getVariantByPosition", () => {
    it("should find all variants by position", () => {
      for (let i = 0; i < SELECT_MASK_SIZE; i++) {
        expect(getVariantByPosition(i)).toBeDefined();
      }
    });

    it("should return undefined for invalid position", () => {
      expect(getVariantByPosition(6)).toBeUndefined();
      expect(getVariantByPosition(99)).toBeUndefined();
      expect(getVariantByPosition(-1)).toBeUndefined();
    });
  });

  describe("getVariantBySuffix", () => {
    it("should find all variants by suffix", () => {
      for (const [, , suffix] of EXPECTED_VARIANTS) {
        expect(getVariantBySuffix(suffix)).toBeDefined();
      }
    });

    it("should return undefined for invalid suffix", () => {
      expect(getVariantBySuffix("_XX")).toBeUndefined();
      expect(getVariantBySuffix("")).toBeUndefined();
    });
  });

  describe("isVariantAbbreviation", () => {
    it("should return true for valid abbreviations", () => {
      expect(isVariantAbbreviation("ST")).toBe(true);
      expect(isVariantAbbreviation("CT")).toBe(true);
      expect(isVariantAbbreviation("CD")).toBe(true);
      expect(isVariantAbbreviation("RESERVED")).toBe(true);
      expect(isVariantAbbreviation("DE")).toBe(true);
      expect(isVariantAbbreviation("SY")).toBe(true);
    });

    it("should return false for invalid abbreviations", () => {
      expect(isVariantAbbreviation("XX")).toBe(false);
      expect(isVariantAbbreviation("")).toBe(false);
      expect(isVariantAbbreviation("st")).toBe(false);
    });
  });
});

// =============================================================================
// SELECT MASK
// =============================================================================

describe("Select Mask", () => {
  describe("generateSelectMask", () => {
    it("should generate mask for ST only", () => {
      expect(generateSelectMask(["ST"])).toEqual([1, 0, 0, 0, 0, 0]);
    });

    it("should generate mask for SY only", () => {
      expect(generateSelectMask(["SY"])).toEqual([0, 0, 0, 0, 0, 1]);
    });

    it("should generate mask for ST + SY", () => {
      expect(generateSelectMask(["ST", "SY"])).toEqual([1, 0, 0, 0, 0, 1]);
    });

    it("should generate mask for all active variants", () => {
      expect(generateSelectMask(["ST", "CT", "CD", "DE", "SY"])).toEqual([
        1, 1, 1, 0, 1, 1,
      ]);
    });

    it("should generate empty mask for empty input", () => {
      expect(generateSelectMask([])).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it("should ignore invalid variants", () => {
      expect(generateSelectMask(["ST", "XX", "INVALID", "SY"])).toEqual([
        1, 0, 0, 0, 0, 1,
      ]);
    });
  });

  describe("parseSelectMask", () => {
    it("should parse mask for ST only", () => {
      expect(parseSelectMask([1, 0, 0, 0, 0, 0])).toEqual(["ST"]);
    });

    it("should parse mask for ST + SY", () => {
      expect(parseSelectMask([1, 0, 0, 0, 0, 1])).toEqual(["ST", "SY"]);
    });

    it("should exclude RESERVED from parsed mask", () => {
      expect(parseSelectMask([0, 0, 0, 1, 0, 0])).toEqual([]);
    });

    it("should parse all-ones mask excluding RESERVED", () => {
      expect(parseSelectMask([1, 1, 1, 1, 1, 1])).toEqual([
        "ST",
        "CT",
        "CD",
        "DE",
        "SY",
      ]);
    });
  });

  describe("formatSelectMask", () => {
    it("should format mask as space-separated string", () => {
      expect(formatSelectMask([1, 1, 0, 0, 0, 1])).toBe("1 1 0 0 0 1");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip variants through mask", () => {
      const originalVariants = ["ST", "CT", "SY"];
      const mask = generateSelectMask(originalVariants);
      const parsed = parseSelectMask(mask);
      expect(parsed).toEqual(originalVariants);
    });
  });
});

// =============================================================================
// ACTIVE VARIANTS
// =============================================================================

describe("Active Variants", () => {
  it("should return 5 active variants", () => {
    expect(getActiveVariants()).toHaveLength(5);
  });

  it("should include all non-reserved variants", () => {
    const active = getActiveVariants();
    const abbrevs = active.map((v) => v.abbreviation);
    for (const expected of ACTIVE_VARIANT_ABBREVS) {
      expect(abbrevs).toContain(expected);
    }
  });

  it("should exclude RESERVED", () => {
    const active = getActiveVariants();
    const abbrevs = active.map((v) => v.abbreviation);
    expect(abbrevs).not.toContain("RESERVED");
  });
});

// =============================================================================
// SELECT MASK POSITIONS
// =============================================================================

describe("Select Mask Positions", () => {
  it("ST should be at position 0", () => {
    expect(SELECT_MASK_POSITIONS.ST).toBe(0);
  });

  it("CT should be at position 1", () => {
    expect(SELECT_MASK_POSITIONS.CT).toBe(1);
  });

  it("CD should be at position 2", () => {
    expect(SELECT_MASK_POSITIONS.CD).toBe(2);
  });

  it("RESERVED should be at position 3", () => {
    expect(SELECT_MASK_POSITIONS.RESERVED).toBe(3);
  });

  it("DE should be at position 4", () => {
    expect(SELECT_MASK_POSITIONS.DE).toBe(4);
  });

  it("SY should be at position 5", () => {
    expect(SELECT_MASK_POSITIONS.SY).toBe(5);
  });
});

// =============================================================================
// FILE TYPES
// =============================================================================

describe("File Types", () => {
  it("EDF should have correct flag", () => {
    expect(FILE_TYPES.EDF.flag).toBe("-EDF");
  });

  it("ASCII should have correct flag", () => {
    expect(FILE_TYPES.ASCII.flag).toBe("-ASCII");
  });

  describe("getFileTypeFromExtension", () => {
    it("should detect EDF files", () => {
      expect(getFileTypeFromExtension("edf")?.name).toBe("EDF");
      expect(getFileTypeFromExtension(".edf")?.name).toBe("EDF");
      expect(getFileTypeFromExtension("EDF")?.name).toBe("EDF");
    });

    it("should detect ASCII files", () => {
      expect(getFileTypeFromExtension("txt")?.name).toBe("ASCII");
      expect(getFileTypeFromExtension("csv")?.name).toBe("ASCII");
      expect(getFileTypeFromExtension("ascii")?.name).toBe("ASCII");
    });

    it("should return undefined for unknown extensions", () => {
      expect(getFileTypeFromExtension("unknown")).toBeUndefined();
      expect(getFileTypeFromExtension("")).toBeUndefined();
    });
  });
});

// =============================================================================
// SCALE PARAMETERS
// =============================================================================

describe("Scale Parameters", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_SCALE_PARAMETERS.scaleMin).toBe(1);
    expect(DEFAULT_SCALE_PARAMETERS.scaleMax).toBe(20);
    expect(DEFAULT_SCALE_PARAMETERS.scaleNum).toBe(20);
  });

  describe("generateDelays", () => {
    it("should generate default delays", () => {
      const delays = generateDelays(DEFAULT_SCALE_PARAMETERS);
      expect(delays).toHaveLength(20);
      expect(delays[0]).toBe(1);
      expect(delays[19]).toBe(20);
    });

    it("should generate single delay", () => {
      const delays = generateDelays({ scaleMin: 5, scaleMax: 5, scaleNum: 1 });
      expect(delays).toEqual([5]);
    });

    it("should generate custom delays", () => {
      const delays = generateDelays({
        scaleMin: 1,
        scaleMax: 10,
        scaleNum: 10,
      });
      expect(delays).toHaveLength(10);
      expect(delays[0]).toBe(1);
      expect(delays[9]).toBe(10);
    });
  });
});

// =============================================================================
// VARIANT ORDER
// =============================================================================

describe("Variant Order", () => {
  it("should match positions", () => {
    VARIANT_REGISTRY.forEach((variant, i) => {
      expect(VARIANT_ORDER[i]).toBe(variant.abbreviation);
    });
  });

  it("should be complete", () => {
    expect(VARIANT_ORDER).toHaveLength(SELECT_MASK_SIZE);
    expect(VARIANT_ORDER).toEqual(["ST", "CT", "CD", "RESERVED", "DE", "SY"]);
  });
});

// =============================================================================
// DIRECT VARIANT ACCESS
// =============================================================================

describe("Direct Variant Access", () => {
  it("ST constant should be correct", () => {
    expect(ST.abbreviation).toBe("ST");
    expect(ST.name).toBe("Single Timeseries");
    expect(ST.position).toBe(0);
  });

  it("CT constant should be correct", () => {
    expect(CT.abbreviation).toBe("CT");
    expect(CT.name).toBe("Cross-Timeseries");
    expect(CT.position).toBe(1);
  });

  it("CD constant should be correct", () => {
    expect(CD.abbreviation).toBe("CD");
    expect(CD.name).toBe("Cross-Dynamical");
    expect(CD.position).toBe(2);
  });

  it("RESERVED constant should be correct", () => {
    expect(RESERVED.abbreviation).toBe("RESERVED");
    expect(RESERVED.name).toBe("Reserved");
    expect(RESERVED.position).toBe(3);
  });

  it("DE constant should be correct", () => {
    expect(DE.abbreviation).toBe("DE");
    expect(DE.name).toBe("Delay Embedding");
    expect(DE.position).toBe(4);
  });

  it("SY constant should be correct", () => {
    expect(SY.abbreviation).toBe("SY");
    expect(SY.name).toBe("Synchronization");
    expect(SY.position).toBe(5);
  });
});

// =============================================================================
// GROUND TRUTH VALIDATION - CLI Command Generation
// =============================================================================

describe("Ground Truth - CLI Command Generation", () => {
  it("SELECT mask for ST-only matches expected CLI format", () => {
    const mask = generateSelectMask(["ST"]);
    const cliArgs = mask.join(" ");
    expect(cliArgs).toBe("1 0 0 0 0 0");
  });

  it("SELECT mask for all active variants matches expected CLI format", () => {
    const mask = generateSelectMask(["ST", "CT", "CD", "DE", "SY"]);
    const cliArgs = mask.join(" ");
    // RESERVED at position 3 should remain 0
    expect(cliArgs).toBe("1 1 1 0 1 1");
  });

  it("SELECT mask positions match the binary expected format", () => {
    /**
     * Ground truth: The DDA binary expects SELECT mask as 6 integers:
     * Position 0: ST (Single Timeseries)
     * Position 1: CT (Cross-Timeseries)
     * Position 2: CD (Cross-Dynamical)
     * Position 3: RESERVED (always 0)
     * Position 4: DE (Delay Embedding)
     * Position 5: SY (Synchronization)
     */
    const testCases: [string, number[]][] = [
      ["ST", [1, 0, 0, 0, 0, 0]],
      ["CT", [0, 1, 0, 0, 0, 0]],
      ["CD", [0, 0, 1, 0, 0, 0]],
      ["DE", [0, 0, 0, 0, 1, 0]],
      ["SY", [0, 0, 0, 0, 0, 1]],
    ];

    for (const [variantAbbrev, expectedMask] of testCases) {
      const mask = generateSelectMask([variantAbbrev]);
      expect(mask).toEqual(expectedMask);
    }
  });
});

// =============================================================================
// GROUND TRUTH VALIDATION - Output File Parsing
// =============================================================================

describe("Ground Truth - Output File Parsing", () => {
  it("ST stride=4 correctly defines 4 columns per channel", () => {
    /**
     * Ground truth: ST output format per channel is:
     * [a1, a2, a3, error] - 4 columns (3 coefficients + 1 error)
     */
    expect(ST.stride).toBe(4);
    expect(ST.outputColumns.coefficients).toBe(3);
    expect(ST.outputColumns.hasError).toBe(true);
    // Total columns = coefficients + error = 3 + 1 = 4 = stride
    const expectedStride =
      ST.outputColumns.coefficients + (ST.outputColumns.hasError ? 1 : 0);
    expect(expectedStride).toBe(ST.stride);
  });

  it("CT stride=4 correctly defines 4 columns per pair", () => {
    /**
     * Ground truth: CT output format per pair is:
     * [a1, a2, a3, error] - 4 columns (3 coefficients + 1 error)
     */
    expect(CT.stride).toBe(4);
    expect(CT.outputColumns.coefficients).toBe(3);
    expect(CT.outputColumns.hasError).toBe(true);
    const expectedStride =
      CT.outputColumns.coefficients + (CT.outputColumns.hasError ? 1 : 0);
    expect(expectedStride).toBe(CT.stride);
  });

  it("CD stride=2 correctly defines 2 columns per directed pair", () => {
    /**
     * Ground truth: CD output format per directed pair is:
     * [a1, error] - 2 columns (1 coefficient + 1 error)
     */
    expect(CD.stride).toBe(2);
    expect(CD.outputColumns.coefficients).toBe(1);
    expect(CD.outputColumns.hasError).toBe(true);
    const expectedStride =
      CD.outputColumns.coefficients + (CD.outputColumns.hasError ? 1 : 0);
    expect(expectedStride).toBe(CD.stride);
  });

  it("DE stride=1 correctly defines 1 column", () => {
    /**
     * Ground truth: DE output format is:
     * [ergodicity] - 1 column (single measure, no error)
     */
    expect(DE.stride).toBe(1);
    expect(DE.outputColumns.coefficients).toBe(0);
    expect(DE.outputColumns.hasError).toBe(false);
  });

  it("SY stride=1 correctly defines 1 column per channel", () => {
    /**
     * Ground truth: SY output format per channel is:
     * [sync_coef] - 1 column (synchronization coefficient, no error)
     */
    expect(SY.stride).toBe(1);
    expect(SY.outputColumns.coefficients).toBe(0);
    expect(SY.outputColumns.hasError).toBe(false);
  });

  it("output file suffixes match what the binary actually produces", () => {
    /**
     * Ground truth: Binary creates files named: {base}{suffix}
     */
    const expectedSuffixes: Record<string, string> = {
      ST: "_ST",
      CT: "_CT",
      CD: "_CD_DDA_ST", // Note: CD has unique suffix format
      RESERVED: "_RESERVED",
      DE: "_DE",
      SY: "_SY",
    };

    for (const [abbrev, expectedSuffix] of Object.entries(expectedSuffixes)) {
      const variant = getVariantByAbbrev(abbrev);
      expect(variant).not.toBeUndefined();
      expect(variant?.outputSuffix).toBe(expectedSuffix);
    }
  });
});

// =============================================================================
// GROUND TRUTH VALIDATION - Mock Output Parsing
// =============================================================================

describe("Ground Truth - Mock Output Parsing", () => {
  it("should parse mock ST output data using spec stride", () => {
    /**
     * Mock ST output: window_start window_end [a1 a2 a3 error] per channel
     * For 2 channels, 1 timepoint:
     */
    const mockData = [0, 1000, 0.1, 0.2, 0.3, 0.01, 0.4, 0.5, 0.6, 0.02];
    //                       ---- channel 0 ----  ---- channel 1 ----

    const stride = ST.stride;
    expect(stride).toBe(4);

    // Extract data for channel 0
    const ch0Start = 2; // Skip window bounds
    const ch0Data = mockData.slice(ch0Start, ch0Start + stride);
    expect(ch0Data).toEqual([0.1, 0.2, 0.3, 0.01]);

    // Extract data for channel 1
    const ch1Start = ch0Start + stride;
    const ch1Data = mockData.slice(ch1Start, ch1Start + stride);
    expect(ch1Data).toEqual([0.4, 0.5, 0.6, 0.02]);
  });

  it("should parse mock CD output data using spec stride", () => {
    /**
     * Mock CD output: window_start window_end [a1 error] per directed pair
     * For 2 directed pairs (1->2, 2->1), 1 timepoint:
     */
    const mockData = [0, 1000, 0.1, 0.01, 0.2, 0.02];
    //                       ---- 1->2 ----  ---- 2->1 ----

    const stride = CD.stride;
    expect(stride).toBe(2);

    // Extract data for pair 1->2
    const p0Start = 2;
    const p0Data = mockData.slice(p0Start, p0Start + stride);
    expect(p0Data).toEqual([0.1, 0.01]);

    // Extract data for pair 2->1
    const p1Start = p0Start + stride;
    const p1Data = mockData.slice(p1Start, p1Start + stride);
    expect(p1Data).toEqual([0.2, 0.02]);
  });

  it("should parse mock SY output data using spec stride", () => {
    /**
     * Mock SY output: window_start window_end [sync_coef] per channel
     * For 3 channels, 1 timepoint:
     */
    const mockData = [0, 1000, 0.95, 0.87, 0.91];
    //                       ch0   ch1   ch2

    const stride = SY.stride;
    expect(stride).toBe(1);

    // Each channel gets 1 value
    for (let i = 0; i < 3; i++) {
      const chStart = 2 + i * stride;
      const chData = mockData.slice(chStart, chStart + stride);
      expect(chData.length).toBe(1);
    }
  });

  it("stride correctly determines number of channels from output width", () => {
    /**
     * Ground truth: data_columns / stride = num_channels
     */
    const testCases: [number, number, number][] = [
      [ST.stride, 8, 2], // 8 data cols / 4 stride = 2 channels
      [ST.stride, 12, 3], // 12 data cols / 4 stride = 3 channels
      [CD.stride, 4, 2], // 4 data cols / 2 stride = 2 pairs
      [SY.stride, 5, 5], // 5 data cols / 1 stride = 5 channels
    ];

    for (const [stride, dataCols, expectedNum] of testCases) {
      expect(dataCols % stride).toBe(0);
      expect(dataCols / stride).toBe(expectedNum);
    }
  });
});

// =============================================================================
// GROUND TRUTH VALIDATION - Required Parameters
// =============================================================================

describe("Ground Truth - Required Parameters", () => {
  it("CT requires -WL_CT and -WS_CT as the binary expects", () => {
    expect(CT.requiredParams).toContain("-WL_CT");
    expect(CT.requiredParams).toContain("-WS_CT");
  });

  it("CD requires -WL_CT and -WS_CT as the binary expects", () => {
    expect(CD.requiredParams).toContain("-WL_CT");
    expect(CD.requiredParams).toContain("-WS_CT");
  });

  it("DE requires -WL_CT and -WS_CT as the binary expects", () => {
    expect(DE.requiredParams).toContain("-WL_CT");
    expect(DE.requiredParams).toContain("-WS_CT");
  });

  it("ST has no special required parameters", () => {
    expect(ST.requiredParams).toHaveLength(0);
  });

  it("SY has no special required parameters", () => {
    expect(SY.requiredParams).toHaveLength(0);
  });
});
