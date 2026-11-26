// Deterministic visual-layer regression checks: verifies colormap LUT endpoints, light/dark diverging defaults,
// and time-axis / selection / cursor canvas drawing calls without requiring a browser GPU.
import { expect, test, vi } from "vitest";
import { drawMarks, drawTimeAxis } from "./axis";
import { colorIndex, LUTS, mapOf, scaleOf } from "./colormaps";
import type { Colors } from "./themeColors";

const LIGHT_COLORS: Colors = {
  trace: [0, 0, 0, 1],
  ground: "#ffffff",
  ink: "#1e2a33",
  grid: "#eceff2",
  hairline: "#dee2e6",
  muted: "#56636e",
  event: "#b4372b",
  eventInk: "#ffffff",
  primary: "#2f6a9e",
  primaryInk: "#ffffff",
  wash: "rgb(47 106 158 / 0.1)",
  font: "system-ui, sans-serif",
};

function mockCanvas2d() {
  const calls: string[] = [];
  const ctx = {
    clearRect: vi.fn(() => calls.push("clearRect")),
    fillRect: vi.fn(() => calls.push("fillRect")),
    strokeRect: vi.fn(() => calls.push("strokeRect")),
    fillText: vi.fn((text: string) => calls.push(`text:${text}`)),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => calls.push("stroke")),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

test("colormaps_respect_dark_diverging_defaults_and_symmetric_limits", () => {
  expect(mapOf("ST", "q", false)).toBe("vik");
  expect(mapOf("ST", "q", true)).toBe("berlin");
  expect(mapOf("ST", "fit_error", true)).toBe("batlow");
  expect(mapOf("DE", "q", false)).toBe("batlow");

  // Diverging maps center symmetrically around zero; mid-index maps to 0.
  const { lo, hi } = scaleOf("vik", -0.2, 1.5);
  expect(lo).toBe(-1.5);
  expect(hi).toBe(1.5);
  expect(colorIndex(0, lo, hi)).toBe(128);
  expect(LUTS.vik.length).toBe(256 * 4);
  expect(LUTS.berlin.length).toBe(256 * 4);
});

test("time_axis_and_marks_render_selection_and_cursor_deterministically", () => {
  const axis = mockCanvas2d();
  drawTimeAxis(axis.ctx, {
    W: 800,
    H: 44,
    dpr: 2,
    view: { t0: 0, t1: 10 },
    cursorS: 4.25,
    colors: LIGHT_COLORS,
  });
  expect(axis.calls[0]).toBe("clearRect");
  expect(axis.calls.some((c) => c.startsWith("text:"))).toBe(true);

  const marks = mockCanvas2d();
  drawMarks(marks.ctx, {
    W: 800,
    H: 200,
    dpr: 2,
    view: { t0: 0, t1: 10 },
    selection: { t0: 2, t1: 6 },
    cursorS: 4.25,
    recording: undefined,
    user: undefined,
    picked: null,
    colors: LIGHT_COLORS,
    over: true,
  });
  expect(marks.calls.filter((c) => c === "fillRect").length).toBeGreaterThanOrEqual(2);
});
