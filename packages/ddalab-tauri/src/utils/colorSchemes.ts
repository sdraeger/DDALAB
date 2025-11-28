/**
 * Color scheme interpolation functions for DDA heatmaps
 * These are defined as module-level constants to avoid recreation on each render
 */

import type { ColorScheme } from "@/components/dda/ColorSchemePicker";

// Helper function to interpolate between color stops
function interpolateColors(
  t: number,
  colors: [number, number, number][],
): string {
  const idx = Math.floor(t * (colors.length - 1));
  const frac = t * (colors.length - 1) - idx;
  const c1 = colors[idx] || colors[0];
  const c2 = colors[idx + 1] || colors[colors.length - 1];
  const r = Math.round(c1[0] + frac * (c2[0] - c1[0]));
  const g = Math.round(c1[1] + frac * (c2[1] - c1[1]));
  const b = Math.round(c1[2] + frac * (c2[2] - c1[2]));
  return `rgb(${r},${g},${b})`;
}

// Viridis color stops
const VIRIDIS_COLORS: [number, number, number][] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 73, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

// Plasma color stops
const PLASMA_COLORS: [number, number, number][] = [
  [13, 8, 135],
  [75, 3, 161],
  [125, 3, 168],
  [168, 34, 150],
  [203, 70, 121],
  [229, 107, 93],
  [248, 148, 65],
  [253, 195, 40],
  [239, 248, 33],
];

// Inferno color stops
const INFERNO_COLORS: [number, number, number][] = [
  [0, 0, 4],
  [31, 12, 72],
  [85, 15, 109],
  [136, 34, 106],
  [186, 54, 85],
  [227, 89, 51],
  [249, 140, 10],
  [249, 201, 50],
  [252, 255, 164],
];

/**
 * Color scheme interpolation functions
 * Maps a value t in [0, 1] to an RGB color string
 */
export const COLOR_SCHEME_FUNCTIONS: Record<
  ColorScheme,
  (t: number) => string
> = {
  viridis: (t: number) => interpolateColors(t, VIRIDIS_COLORS),
  plasma: (t: number) => interpolateColors(t, PLASMA_COLORS),
  inferno: (t: number) => interpolateColors(t, INFERNO_COLORS),
  jet: (t: number) => {
    const r = Math.max(
      0,
      Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.75)))),
    );
    const g = Math.max(
      0,
      Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.5)))),
    );
    const b = Math.max(
      0,
      Math.min(255, Math.round(255 * (1.5 - 4 * Math.abs(t - 0.25)))),
    );
    return `rgb(${r},${g},${b})`;
  },
  cool: (t: number) => {
    const r = Math.round(t * 255);
    const g = Math.round((1 - t) * 255);
    const b = 255;
    return `rgb(${r},${g},${b})`;
  },
  hot: (t: number) => {
    let r: number, g: number, b: number;
    if (t < 0.4) {
      r = Math.round((255 * t) / 0.4);
      g = 0;
      b = 0;
    } else if (t < 0.8) {
      r = 255;
      g = Math.round((255 * (t - 0.4)) / 0.4);
      b = 0;
    } else {
      r = 255;
      g = 255;
      b = Math.round((255 * (t - 0.8)) / 0.2);
    }
    return `rgb(${r},${g},${b})`;
  },
};

/**
 * Get color for a value using the specified color scheme
 */
export function getColorForValue(
  t: number,
  scheme: ColorScheme = "viridis",
): string {
  return COLOR_SCHEME_FUNCTIONS[scheme](t);
}
