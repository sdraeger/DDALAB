// Heatmap color maps as 256-entry RGBA tables: Crameri's batlow (sequential) and vik (diverging, centered at zero),
// from cmcrameri 1.10, each entry rounded to sRGB bytes (colormaps.test.ts checks them against fixtures/). The notice
// below is a legal comment the build keeps (scripts/check-dist.mjs checks it); fixtures/CRAMERI-LICENSE.txt is the
// license as cmcrameri ships it.
/*!
 * The batlow and vik color maps of Crameri's Scientific colour maps.
 * Crameri, F. (2018). Scientific colour maps. Zenodo. doi:10.5281/zenodo.1243862
 *
 * MIT License, Copyright (c) 2020 Fabio Crameri
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

export type MapName = "batlow" | "vik";

/** 256 rows of r, g, b bytes, base64. */
const TABLES: Record<MapName, string> = {
  batlow:
    "ARlZAhtZAxxaBB5aBR9aBiFbByJbByRbCCVbCSdcCihcCipcCytcCy1dDC5dDC9dDTFdDTJeDTNeDjVeDjZeDjdeDzhfDzlfDztfDzxfED1fED5fED9gEEBgEUFgEUJgEUNgEURgEkVhEkZhEkdhEkhhE0lhE0phE0thFExiFE1iFE5iFU9iFU9iFlBiFlFiF1JiF1NiGFRiGFViGVZiGVdiGldiG1hiG1liHFpiHVtiHlxiHl1iH11hIF5hIV9hImBhI2BgJGFgJWJgJmNfJ2NfKGRfKmVeK2VeLGZdLWddL2dcMGhcMWlbM2laNGpaNWpZN2tYOGxYOmxXO21WPG1WPm5VP25UQW9TQm9SRHBSRXBRR3FQSHFPSnJOTHJNTXNNT3NMUHRLUnRKU3VJVXVIV3ZHWHZGWndFW3dFXXhEX3hDYHlCYnlBY3pAZXo/Z3s+aHs+ans9bHw8bXw7b306cX05c344dH44dn83eH82eYA1e4A0fYE0f4EzgYIygoIxhIMxhoMwiIQvioQvjIUujoUuj4YtkYYtk4cslYcsl4gsmYgsm4krnYkrn4kroYoro4ospYssp4ssqYwsq4wtrYwtr40usY0vs44vtY4wt44xuY8yu48zvY80vpA1wJA2wpA3xJE4xpE6yJE7ypI8y5I+zZI/z5NA0ZNC0pND1JRF1pRG2JRI2ZVK25VL3ZVN3pZP4JZR4ZdS45dU5JdW5phY55ha6Zlc6ple65pg7Zpi7ptk75tn8Jxp8Z1r8p1t855w9J9y9Z909qB396F5+KF7+KJ++aOA+aOC+qSF+qWH+6aJ+6aM/KeO/KiQ/KmT/KmV/aqX/aua/ayc/aye/a2g/a6i/a+l/a+n/bCp/bGr/bKt/bKv/bOx/bS0/bS2/bW4/ba6/be8/be+/bjA/bnC/brE/brH/bvJ/bzL/bzN/L3P/L7R/L/T/L/W/MDY/MHa/MLc/MPf/MPh/MTj/MXl+8bo+8bq+8fs+8jv+8nx+8rz+8r2+sv4+sz6",
  vik: "ABJhARRiARVjARdkARhlARpmAhxnAh1oAh9pAiBqAiJrAiNsAiVtAiduAihvAipwAitxAi1yAi5zAjB0AjF1AjN2AjR3AjZ4Ajd5Ajl6Ajp7Azx8Az59Az9+A0F/A0KAA0SBA0WCA0eDA0mEA0qFBEyGBE2HBE+IBVGJBVKKBlSLBlaMB1eNCFmPCVuQC12RDF6SDmCTEGKUEWSWE2aXFWeYF2mZGWuaHG2cHm+dIHGeI3OgJXWhKHeiK3mkLXulMH2mM3+oNoGpOYOrPIWsP4etQomvRYuwSI2yS5CzTpK0UZS2VJa3V5i5Wpq6XZy7YZ69ZKC+Z6LAaqTBbabCcajEdKrFd6zGeq7IfbDJgLLKhLTMh7bNirjOjbrQkLzRlL7Sl8DUmsLVncTWoMXYo8fZp8naqsvcrc3dsM/es9HfttPhutXivdbjwNjkw9rlxtvmyd3nzN/oz+Do0uHp1ePp2OTp2+Xp3ubp4Obp4ufo5efo5+fn6Ofl6ubk6+bi7OXg7eTe7uPc7uHa7uDY7t7V7t3T7tvQ7tnN7dfL7dXI7NPF7NHD69DA6s696cy66cq46Mi158ay5sSw5cGt5L+q5L6o47yl4rqi4big4Lad37Sa37KY3rCV3a6T3KyQ26qN26iL2qaI2aSG2KKD16CB1p9+1p181Zt51Jl305d005Vy0pRw0ZJt0JBrz45oz4xmzotkzYlhzIdfzIVdy4NayoJYyYBWyX5TyHxRx3tPxnlMxndKxXVIxHRFw3JDwnBBwm4/wW08wGs6v2k4vmc2vmUzvWQxvGIvu2Atul4quFwot1omtlgktVUhs1MfslEdsE8br0wYrUoWq0gUqUUSp0MQpUAPoz4NoTwLnzkKnDcJmjUImDMHljEHlC8GkS0GjysGjSkGiycGiSYGhyQGhSIGgyEGgR8Gfx4Gfh0GfBsGehoGeBgGdhcGdBUGcxQGcRMHbxEHbRAHbA4Hag0HaAwHZwoHZQkHYwcHYgYHYAQIXgMIXQIIWwEIWQAI",
};

function table(base64: string): Uint8Array {
  const rgb = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    lut.set(rgb.subarray(3 * i, 3 * i + 3), 4 * i);
    lut[4 * i + 3] = 255;
  }
  return lut;
}

export const LUTS: Record<MapName, Uint8Array> = { batlow: table(TABLES.batlow), vik: table(TABLES.vik) };

/**
 * The map of an array by its kind. Q of ST and CT is the a1 coefficient, of CD a gain in RMSE and of SY a difference
 * of RMSE ratios: signed, with zero meaning none (vik). Q of DE is an absolute value and a fit error an RMSE:
 * sequential (batlow).
 */
const SIGNED = new Set(["ST/q", "CT/q", "CD/q", "SY/q"]);
export const mapOf = (variant: string, array: "q" | "fit_error"): MapName =>
  SIGNED.has(`${variant}/${array}`) ? "vik" : "batlow";

/**
 * The limits of a map over finite values from `min` to `max`: vik symmetric about zero, batlow from `min` to `max`.
 * Without a finite value (`min > max`) or without a spread, the limits widen by one.
 */
export function scaleOf(map: MapName, min: number, max: number): { lo: number; hi: number } {
  if (!(min <= max)) return { lo: -1, hi: 1 };
  if (map === "vik") {
    const m = Math.max(Math.abs(min), Math.abs(max));
    return m > 0 ? { lo: -m, hi: m } : { lo: -1, hi: 1 };
  }
  return max > min ? { lo: min, hi: max } : { lo: min - 1, hi: max + 1 };
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
