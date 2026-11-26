import { expect, test } from "vitest";
import { clampAndSnap, resolveDropZone, snapRatio, snapValue } from "./layoutSnap";

test("snapValue_engages_nearest_stop_within_threshold", () => {
  expect(snapValue(283, [240, 288, 360], 10)).toEqual({ value: 288, snapped: 288 });
  expect(snapValue(297, [240, 288, 360], 10)).toEqual({ value: 288, snapped: 288 });
  expect(snapValue(310, [240, 288, 360], 10)).toEqual({ value: 310, snapped: null });
});

test("clampAndSnap_clamps_before_snapping", () => {
  expect(clampAndSnap(100, 220, 440, [240, 288, 360], 10)).toEqual({ value: 220, snapped: null });
  expect(clampAndSnap(500, 220, 440, [240, 288, 360], 10)).toEqual({ value: 440, snapped: null });
  expect(clampAndSnap(235, 220, 440, [240, 288, 360], 10)).toEqual({ value: 240, snapped: 240 });
});

test("snapRatio_clamps_and_snaps_to_thirds_and_half", () => {
  expect(snapRatio(0.49)).toEqual({ value: 0.5, snapped: 0.5 });
  expect(snapRatio(0.34)).toEqual({ value: 0.33, snapped: 0.33 });
  expect(snapRatio(0.66)).toEqual({ value: 0.67, snapped: 0.67 });
  expect(snapRatio(0.42)).toEqual({ value: 0.42, snapped: null });
  expect(snapRatio(0.1)).toEqual({ value: 0.25, snapped: null });
  expect(snapRatio(0.95)).toEqual({ value: 0.75, snapped: null });
});

test("resolveDropZone_maps_edges_and_center", () => {
  const rect = { left: 100, top: 50, width: 1000, height: 600 };
  expect(resolveDropZone(150, 350, rect)).toBe("left");
  expect(resolveDropZone(1060, 350, rect)).toBe("right");
  expect(resolveDropZone(600, 90, rect)).toBe("top");
  expect(resolveDropZone(600, 620, rect)).toBe("bottom");
  expect(resolveDropZone(600, 350, rect)).toBe("center");
  // Without center allowed (result panel dock), interior points snap to the nearest edge.
  expect(resolveDropZone(600, 500, rect, ["top", "bottom", "left", "right"])).toBe("bottom");
  expect(resolveDropZone(850, 350, rect, ["top", "bottom", "left", "right"])).toBe("right");
});
