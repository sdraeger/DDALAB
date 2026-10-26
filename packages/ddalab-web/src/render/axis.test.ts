import { expect, test } from "vitest";
import { column } from "./axis";

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
