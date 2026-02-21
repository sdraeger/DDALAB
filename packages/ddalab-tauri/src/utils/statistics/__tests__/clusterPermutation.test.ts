import { describe, it, expect } from "vitest";
import { clusterPermutationTest } from "../clusterPermutation";

function syntheticGroup(
  nSubjects: number,
  nWindows: number,
  bumpStart: number,
  bumpEnd: number,
  bumpValue: number,
): number[][] {
  const group: number[][] = [];
  for (let s = 0; s < nSubjects; s++) {
    const row: number[] = [];
    for (let w = 0; w < nWindows; w++) {
      const pseudo = ((s * 17 + w * 31) % 100) / 100; // deterministic [0,1)
      const noise = (pseudo - 0.5) * 0.2;
      const bump = w >= bumpStart && w <= bumpEnd ? bumpValue : 0;
      row.push(noise + bump);
    }
    group.push(row);
  }
  return group;
}

describe("clusterPermutationTest", () => {
  it("detects a contiguous significant cluster", () => {
    const groupA = syntheticGroup(8, 64, 20, 30, 1.2);
    const groupB = syntheticGroup(8, 64, 20, 30, 0.0);

    const result = clusterPermutationTest(groupA, groupB, {
      iterations: 800,
      alpha: 0.05,
      clusterFormingT: 2.0,
    });

    expect(result.clusters.length).toBeGreaterThan(0);
    expect(result.minClusterP).toBeLessThan(0.05);
    expect(result.significantMask.some(Boolean)).toBe(true);
  });

  it("returns non-significant result for matched groups", () => {
    const groupA = syntheticGroup(8, 64, 0, 0, 0.0);
    const groupB = syntheticGroup(8, 64, 0, 0, 0.0);

    const result = clusterPermutationTest(groupA, groupB, {
      iterations: 400,
      alpha: 0.05,
      clusterFormingT: 2.0,
    });

    expect(result.minClusterP).toBeGreaterThanOrEqual(0.05);
  });

  it("handles insufficient input gracefully", () => {
    const result = clusterPermutationTest([[1, 2, 3]], [[1, 2, 3]], {
      iterations: 200,
    });

    expect(result.tStatistics).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.significantMask).toEqual([]);
    expect(result.minClusterP).toBe(1);
  });
});
