import { expect, test } from "vitest";
import type { OpenRecording } from "../store/store";
import { column, drawRuler } from "./axis";
import type { Colors } from "./themeColors";

/** What `column` draws: its calls to a 2D context, by name and arguments. */
function drawn(dashed: boolean, dpr: number) {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push([name, ...args]);
  const ctx = {
    fillStyle: "red",
    fillRect: record("fillRect"),
    save: record("save"),
    restore: record("restore"),
    setLineDash: record("setLineDash"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke(this: { strokeStyle: string; lineWidth: number }) {
      calls.push(["stroke", this.strokeStyle, this.lineWidth]);
    },
  } as unknown as CanvasRenderingContext2D & { strokeStyle: string; lineWidth: number };
  column(ctx, 5, 10, 1, 30 * dpr, dashed, dpr);
  return calls;
}

test("file_event_lines_are_dashed_and_user_lines_solid", () => {
  expect(drawn(false, 1)).toEqual([["fillRect", 5, 10, 1, 30]]);
  // One stroke, 4 px on and 3 off in CSS pixels, down the middle of the line's pixel column.
  expect(drawn(true, 2)).toEqual([
    ["save"],
    ["setLineDash", [8, 6]],
    ["beginPath"],
    ["moveTo", 5.5, 10],
    ["lineTo", 5.5, 70],
    ["stroke", "red", 1],
    ["restore"],
  ]);
});

test("ruler_flags_keep_their_labels_and_tick_labels_give_way", () => {
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
  // The long flag runs to the next flag, its text cut with an ellipsis only there.
  expect(flags[0].x1).toBeLessThanOrEqual(300 - 2);
  expect(flags[0].x1).toBeGreaterThan(290);
  expect(texts.find(([text]) => text.startsWith("a label"))?.[0]).toMatch(/…$/);
  // A tick label a flag covers moves to the left of its tick, else it is left out; the others stay.
  expect(at["1"]).toBe(100 - 3 - 6);
  expect(at["2"]).toBeUndefined();
  // 3 s: its right is the short flag, its left the long one.
  expect(at["3"]).toBeUndefined();
  for (let s = 4; s <= 9; s++) expect(at[String(s)], `${s} s`).toBe(100 * s + 3);
});
