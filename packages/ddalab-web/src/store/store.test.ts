import { expect, test } from "vitest";
import type { AnalysisRecord } from "../core/history";
import {
  type OpenRecording,
  openResult,
  pageOf,
  removeRecording,
  setShownResult,
  setView,
  showResult,
  useStore,
  type View,
} from "./store";

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

const record = (id: string, fingerprint: string, status: AnalysisRecord["status"]) =>
  ({ id, fingerprint, status }) as AnalysisRecord;
const recording = (fingerprint: string) =>
  ({
    fingerprint,
    info: { duration_s: 60, sample_rate_hz: 100 },
    analysis_channels: [0],
  }) as unknown as OpenRecording;

test("open_result_shows_complete_records_under_their_own_recording", () => {
  useStore.setState({
    analyses: [
      record("run", "fa", "running"),
      record("a", "fa", "complete"),
      record("imported", "", "complete"),
    ],
    recordings: { A: recording("fa"), B: recording("fb") },
    activeRecordingId: "B",
  });
  // A record that is not complete opens its provenance only.
  openResult("run");
  expect(useStore.getState()).toMatchObject({
    activeResultId: "run",
    shownResult: null,
    activeRecordingId: "B",
  });
  // A complete one makes its open recording the active one.
  openResult("a");
  expect(useStore.getState()).toMatchObject({
    shownResult: { id: "a", variant: null },
    activeRecordingId: "A",
  });
  // Opened again it keeps what was picked.
  setShownResult({ variant: "CD", array: "fit_error", row: 1 });
  openResult("a");
  expect(useStore.getState().shownResult).toMatchObject({ variant: "CD", array: "fit_error", row: 1 });
  // One whose recording is not open shows alone, with no recording active.
  openResult("imported");
  expect(useStore.getState()).toMatchObject({ shownResult: { id: "imported" }, activeRecordingId: null });
  openResult(null);
  expect(useStore.getState()).toMatchObject({ activeResultId: null, shownResult: null });
});

test("a_result_shown_alone_bounds_the_view", () => {
  useStore.setState({
    recordings: {},
    activeRecordingId: null,
    analyses: [record("imported", "", "complete")],
  });
  openResult("imported");
  setShownResult({ interval: { t0: 100, t1: 200 } });
  setView({ t0: 50, t1: 120 });
  expect(useStore.getState().view).toMatchObject({ t0: 100, t1: 170 });
  setView({ t0: 0, t1: 1000 });
  expect(useStore.getState().view).toMatchObject({ t0: 100, t1: 200 });
});

/** A complete record whose manifest says it analyzed 100 s to 160 s. */
const analyzed = (id: string, fingerprint: string) =>
  ({
    ...record(id, fingerprint, "complete"),
    manifest: { reproduction: { start_time_seconds: 100, end_time_seconds: 160 } },
  }) as AnalysisRecord;
/** The view of the first store update that shows result `id`. */
function viewWhenShown(id: string, act: () => void) {
  let first: View | undefined;
  const stop = useStore.subscribe((s) => {
    if (s.shownResult?.id === id && first === undefined) first = s.view;
  });
  act();
  stop();
  return first;
}

test("a_result_that_comes_to_show_alone_starts_on_its_interval", () => {
  useStore.setState({
    recordings: { A: recording("fa") },
    activeRecordingId: "A",
    shownResult: null,
    analyses: [analyzed("imported", ""), analyzed("a", "fa")],
  });
  // Opened with no recording of its own: in the same update as it shows, on its interval.
  expect(viewWhenShown("imported", () => openResult("imported"))).toMatchObject({ t0: 100, t1: 160 });
  expect(useStore.getState()).toMatchObject({
    activeRecordingId: null,
    shownResult: { interval: { t0: 100, t1: 160 } },
  });
  // Opened again it keeps the view it has.
  setView({ t0: 110, t1: 120 });
  openResult("imported");
  expect(useStore.getState().view).toMatchObject({ t0: 110, t1: 120 });
  // Its recording closed, a result stays on alone and moves to its interval.
  openResult("a");
  expect(useStore.getState().activeRecordingId).toBe("A");
  setView({ t0: 0, t1: 10 });
  removeRecording("A");
  expect(useStore.getState()).toMatchObject({
    activeRecordingId: null,
    shownResult: { id: "a" },
    view: { t0: 100, t1: 160 },
  });
  // A run that ends with its recording closed shows alone too.
  setView({ t0: 0, t1: 10 });
  expect(viewWhenShown("run", () => showResult(analyzed("run", "fa")))).toMatchObject({ t0: 100, t1: 160 });
});
