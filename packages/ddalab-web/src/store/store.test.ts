import { expect, test } from "vitest";
import { pageOf, type View } from "./store";

const view = (t0: number, t1: number, epochS: 10 | 20 | 30 = 10): View => ({
  t0,
  t1,
  epochS,
  firstChannel: 0,
  rowCount: 16,
  sensitivityUvPerMm: 70,
  mmPerCssMm: 1,
});

test("last_page_when_the_view_reaches_the_end", () => {
  // 25 s at 10 s epochs: three pages, the last one starts at 15 s once the view is held inside the recording.
  expect(pageOf(view(0, 10), 25)).toEqual([1, 3]);
  expect(pageOf(view(10, 20), 25)).toEqual([2, 3]);
  expect(pageOf(view(15, 25), 25)).toEqual([3, 3]);
  expect(pageOf(view(10, 30, 20), 30)).toEqual([2, 2]);
  expect(pageOf(view(20, 30), 30)).toEqual([3, 3]);
});
