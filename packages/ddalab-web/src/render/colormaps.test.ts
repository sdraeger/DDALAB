import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { LUTS, type MapName, mapOf, scaleOf } from "./colormaps";

/** A table of cmcrameri 1.10 (fixtures/, 256 rows of r g b in 0 to 1), as sRGB bytes rounded from the floats. */
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

test("tables_are_the_published_batlow_and_vik", () => {
  for (const map of ["batlow", "vik"] as const) expect([...LUTS[map]]).toEqual(published(map));
});

test("map_follows_the_array_kind", () => {
  for (const variant of ["ST", "CT", "CD", "SY"]) expect(mapOf(variant, "q")).toBe("vik");
  expect(mapOf("DE", "q")).toBe("batlow");
  for (const variant of ["ST", "CT"]) expect(mapOf(variant, "fit_error")).toBe("batlow");
  // Vik is centered at zero whatever the values; batlow spans them.
  expect(scaleOf("vik", -0.2, -0.1)).toEqual({ lo: -0.2, hi: 0.2 });
  expect(scaleOf("vik", 0.1, 0.3)).toEqual({ lo: -0.3, hi: 0.3 });
  expect(scaleOf("batlow", 0.3, 0.4)).toEqual({ lo: 0.3, hi: 0.4 });
});
