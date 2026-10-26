import { expect, test } from "vitest";
import type { OpenRecording } from "../store/store";
import { column, drawRuler } from "./axis";
import type { Colors } from "./themeColors";

/** The rectangles `column` fills, as [x, y, w, h]. */
function filled(dashed: boolean, dpr: number) {
  const rects: number[][] = [];
  const ctx = { fillRect: (...r: number[]) => rects.push(r) } as unknown as CanvasRenderingContext2D;
  column(ctx, 5, 10, 1, 30 * dpr, dashed, dpr);
  return rects;
}

test("file_event_lines_are_dashed_and_user_lines_solid", () => {
  expect(filled(false, 1)).toEqual([[5, 10, 1, 30]]);
  // 4 px on, 3 off, the last dash cut at the end.
  expect(filled(true, 1)).toEqual([
    [5, 10, 1, 4],
    [5, 17, 1, 4],
    [5, 24, 1, 4],
    [5, 31, 1, 4],
    [5, 38, 1, 2],
  ]);
  expect(filled(true, 2).map(([, y, , h]) => [y, h])).toEqual([
    [10, 8],
    [24, 8],
    [38, 8],
    [52, 8],
    [66, 4],
  ]);
});

test("ruler_tick_labels_stay_and_flags_elide_before_them", () => {
  // A 2D context whose text is 6 px a letter; it records the text it draws and where.
  const texts: [string, number][] = [];
  const ctx = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText: (text: string, x: number) => texts.push([text, x]),
    measureText: (text: string) => ({ width: 6 * text.length }),
  } as unknown as CanvasRenderingContext2D;
  const recording = { info: { annotations: [] } } as unknown as OpenRecording;
  const user = [
    { id: "long", onset_s: 1.05, duration_s: 0, label: "a label far longer than a second" },
    { id: "on", onset_s: 3, duration_s: 0, label: "x" },
  ];
  // 1000 px for 10 s: a tick and its label every second.
  const flags = drawRuler(ctx, {
    W: 1000,
    H: 22,
    dpr: 1,
    view: { t0: 0, t1: 10 },
    recording,
    user,
    picked: null,
    colors: {} as Colors,
  });
  const at = Object.fromEntries(texts);
  // Every tick from 1 to 9 keeps its label. One a flag starts on moves to the left of its tick.
  for (let s = 1; s <= 9; s++) expect(at[String(s)], `${s} s`).toBeDefined();
  expect(at["1"]).toBe(100 - 3 - 6);
  expect(at["3"]).toBe(300 - 3 - 6);
  expect(at["2"]).toBe(203);
  // The long flag ends before the label of 2 s, its text cut with an ellipsis.
  expect(flags[0].x1).toBeLessThanOrEqual(203 - 2);
  expect(texts.find(([text]) => text.startsWith("a label"))?.[0]).toMatch(/…$/);
});
