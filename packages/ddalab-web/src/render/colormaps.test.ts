import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { LUTS, MAPS, type MapName, mapOf, scaleOf } from "./colormaps";

/**
 * A published table (fixtures/: cmcrameri 1.10, or matplotlib 3.6.3 sampled at 256 points; 256 rows of r g b in 0 to
 * 1), as sRGB bytes rounded from the floats.
 */
function published(map: MapName): number[] {
  const text = readFileSync(new URL(`./fixtures/${map}.txt`, import.meta.url), "utf8");
  const rows = text.trim().split("\n");
  expect(rows).toHaveLength(256);
  return rows.flatMap((row) => [
    ...row
      .trim()
      .split(/\s+/)
      .map((v) => Math.round(Number(v) * 255)),
    255,
  ]);
}

test("tables_are_the_published_maps", () => {
  for (const map of MAPS.map((m) => m.name)) expect([...LUTS[map]], map).toEqual(published(map));
});

test("a_picked_map_replaces_the_automatic_one", () => {
  expect(mapOf("ST", "q", false, "jet")).toBe("jet");
  expect(mapOf("DE", "q", true, "inferno")).toBe("inferno");
  expect(mapOf("ST", "q", true, null)).toBe("berlin");
  // Only a diverging map centers the limits at zero.
  expect(scaleOf("jet", -0.2, 0.1)).toEqual({ lo: -0.2, hi: 0.1 });
  expect(scaleOf("viridis", 0.3, 0.4)).toEqual({ lo: 0.3, hi: 0.4 });
});

test("map_follows_the_array_kind", () => {
  for (const variant of ["ST", "CT", "CD", "SY"]) expect(mapOf(variant, "q")).toBe("vik");
  // In the dark theme signed arrays take berlin, dark in the middle; sequential ones keep batlow.
  for (const variant of ["ST", "CT", "CD", "SY"]) expect(mapOf(variant, "q", true)).toBe("berlin");
  expect(mapOf("DE", "q", true)).toBe("batlow");
  expect(mapOf("ST", "fit_error", true)).toBe("batlow");
  expect(scaleOf("berlin", 0.1, 0.3)).toEqual({ lo: -0.3, hi: 0.3 });
  expect(mapOf("DE", "q")).toBe("batlow");
  for (const variant of ["ST", "CT"]) expect(mapOf(variant, "fit_error")).toBe("batlow");
  // Vik is centered at zero whatever the values; batlow spans them.
  expect(scaleOf("vik", -0.2, -0.1)).toEqual({ lo: -0.2, hi: 0.2 });
  expect(scaleOf("vik", 0.1, 0.3)).toEqual({ lo: -0.3, hi: 0.3 });
  expect(scaleOf("batlow", 0.3, 0.4)).toEqual({ lo: 0.3, hi: 0.4 });
});
