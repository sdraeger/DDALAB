// Heatmap color maps as 256-entry RGBA tables: Crameri's batlow (sequential) and vik (diverging, centered at zero).
// Crameri, F. (2018). Scientific colour maps. Zenodo. doi:10.5281/zenodo.1243862
// shortcut: each table is interpolated in sRGB between nine stops of the published map; replace the stops with the
// published 256-entry tables once downloading them is approved.

export type MapName = "batlow" | "vik";

const STOPS: Record<MapName, string[]> = {
  batlow: ["#011959", "#0e3a62", "#1f5c67", "#42785b", "#7b8738", "#b98b35", "#e58a58", "#fb9ca0", "#faccfa"],
  vik: ["#001261", "#033e7d", "#1e6ea6", "#7aa9cb", "#ece5e0", "#d9a888", "#c06d3a", "#8e2c10", "#590008"],
};

function table(stops: string[]): Uint8Array {
  const rgb = stops.map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const at = (i / 255) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(at));
    for (let c = 0; c < 3; c++)
      lut[4 * i + c] = Math.round(rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * (at - k));
    lut[4 * i + 3] = 255;
  }
  return lut;
}

export const LUTS: Record<MapName, Uint8Array> = { batlow: table(STOPS.batlow), vik: table(STOPS.vik) };

/**
 * The map and limits of an array whose finite values run from `min` to `max`: with a negative value among them it is
 * signed (vik, limits symmetric about zero), else sequential (batlow from `min` to `max`).
 */
export function scaleOf(min: number, max: number): { map: MapName; lo: number; hi: number } {
  if (!(min <= max)) return { map: "batlow", lo: 0, hi: 1 }; // no finite value
  if (min < 0) {
    const m = Math.max(-min, Math.abs(max));
    return { map: "vik", lo: -m, hi: m };
  }
  return max > min ? { map: "batlow", lo: min, hi: max } : { map: "batlow", lo: min - 1, hi: max + 1 };
}

/** The entry `value` draws as between the limits, as the heatmap shader picks it. */
export const colorIndex = (value: number, lo: number, hi: number) =>
  Math.floor(Math.min(1, Math.max(0, (value - lo) / (hi - lo))) * 255 + 0.5);

/** The map as a CSS gradient from left to right, for the color bar. */
export function gradient(map: MapName): string {
  const lut = LUTS[map];
  const stops = Array.from({ length: 17 }, (_, s) => {
    const i = Math.round((s / 16) * 255);
    return `rgb(${lut[4 * i]} ${lut[4 * i + 1]} ${lut[4 * i + 2]}) ${(s / 16) * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
