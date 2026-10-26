import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { loadAnnotations, saveAnnotations } from "../../core/userAnnotations";
import { type OpenRecording, useStore } from "../../store/store";
import { eventsJson, eventsTsv } from "./events";
import {
  annotate,
  create,
  discard,
  labelCreated,
  labelsOf,
  listed,
  pointer,
  redo,
  remove,
  resized,
  undo,
  update,
  within,
} from "./model";

const list = (fingerprint: string) =>
  (useStore.getState().annotations[fingerprint] ?? []).map(({ onset_s, duration_s, label }) => [
    onset_s,
    duration_s,
    label,
  ]);

test("create_edit_move_resize_delete_and_undo_each", () => {
  const fp = "model";
  const a = create(fp, 1, 0);
  update(fp, a.id, { label: "spike" });
  update(fp, a.id, { onset_s: 4 });
  const b = create(fp, 10, 2);
  expect(b.label).toBe("spike"); // the label saved last
  update(fp, b.id, resized({ ...b }, "end", 15));
  remove(fp, a.id);
  expect(list(fp)).toEqual([[10, 5, "spike"]]);
  // Each change is one step back, in turn.
  const steps = [
    [
      [4, 0, "spike"],
      [10, 5, "spike"],
    ],
    [
      [4, 0, "spike"],
      [10, 2, "spike"],
    ],
    [[4, 0, "spike"]],
    [[1, 0, "spike"]],
    [[1, 0, ""]],
    [],
  ];
  for (const expected of steps) {
    expect(undo(fp)).toBe(true);
    expect(list(fp)).toEqual(expected);
  }
  expect(undo(fp)).toBe(false);
  // Redo walks forward again; a new change drops what is left to redo.
  expect(redo(fp)).toBe(true);
  expect(redo(fp)).toBe(true);
  expect(list(fp)).toEqual([[1, 0, "spike"]]);
  create(fp, 3, 0);
  expect(redo(fp)).toBe(false);
});

test("a_created_annotation_and_its_label_are_one_step", () => {
  const fp = "label";
  const a = create(fp, 2, 0);
  labelCreated(fp, a.id, "artifact");
  expect(list(fp)).toEqual([[2, 0, "artifact"]]);
  undo(fp);
  expect(list(fp)).toEqual([]);
});

test("a_discarded_creation_leaves_nothing_to_undo", () => {
  const fp = "discard";
  const kept = create(fp, 1, 0);
  const dropped = create(fp, 5, 0);
  discard(fp, dropped.id);
  expect(list(fp).map(([onset]) => onset)).toEqual([1]);
  undo(fp);
  expect(list(fp)).toEqual([]);
  redo(fp);
  expect(useStore.getState().annotations[fp].map((a) => a.id)).toEqual([kept.id]);
});

test("removing_the_picked_annotation_lets_it_go", () => {
  const fp = "picked";
  const a = create(fp, 1, 0);
  useStore.setState({ pickedAnnotation: a.id, annotationEditor: { id: a.id, created: false } });
  remove(fp, a.id);
  expect(useStore.getState().pickedAnnotation).toBeNull();
  expect(useStore.getState().annotationEditor).toBeNull();
});

test("a_resized_span_turns_over_past_its_other_edge", () => {
  const a = { id: "x", onset_s: 10, duration_s: 4, label: "" };
  expect(resized(a, "end", 12)).toMatchObject({ onset_s: 10, duration_s: 2 });
  expect(resized(a, "end", 7)).toMatchObject({ onset_s: 7, duration_s: 3 });
  expect(resized(a, "start", 8)).toMatchObject({ onset_s: 8, duration_s: 6 });
  expect(resized(a, "start", 16)).toMatchObject({ onset_s: 14, duration_s: 2 });
  expect(within(-1, 3, 30)).toEqual({ onset_s: 0, duration_s: 3 });
  expect(within(29, 3, 30)).toEqual({ onset_s: 29, duration_s: 1 });
});

test("annotate_marks_the_selection_the_pointer_the_cursor_or_the_middle", () => {
  const recording = { fingerprint: "here", info: { duration_s: 30 } } as unknown as OpenRecording;
  const view = { ...useStore.getState().view, t0: 10, t1: 20 };
  useStore.setState({ recordings: { r: recording }, activeRecordingId: "r", view, cursorS: null });
  const last = () => {
    const { annotations, annotationEditor } = useStore.getState();
    const made = annotations.here.at(-1);
    expect(annotationEditor).toEqual({ id: made?.id, created: true });
    return [made?.onset_s, made?.duration_s];
  };
  useStore.setState({ selection: { t0: 11, t1: 13 } });
  annotate();
  expect(last()).toEqual([11, 2]);
  annotate(14); // a double-click's time wins over the selection
  expect(last()).toEqual([14, 0]);
  useStore.setState({ selection: null, cursorS: 12 });
  pointer.s = 18;
  annotate();
  expect(last()).toEqual([18, 0]);
  pointer.s = null;
  annotate();
  expect(last()).toEqual([12, 0]);
  useStore.setState({ cursorS: 25 }); // off screen
  annotate();
  expect(last()).toEqual([15, 0]);
});

test("file_and_user_annotations_listed_by_time_with_their_source", () => {
  const files = [
    { onset_s: 20, duration_s: 0, label: "spike", source: "EDF Annotations" },
    { onset_s: 2.5, duration_s: 1, label: "eyes closed", source: "events.tsv" },
  ];
  const user = [{ id: "u", onset_s: 5, duration_s: 0, label: "spike" }];
  const rows = listed(files, ["sub-01_eeg.edf", "sub-01_events.tsv"], user);
  expect(rows.map((r) => [r.id, r.onset_s, r.source, r.user])).toEqual([
    ["file:1", 2.5, "sub-01_events.tsv", false],
    ["u", 5, "Yours", true],
    ["file:0", 20, "sub-01_eeg.edf", false],
  ]);
  expect(labelsOf(files, user)).toEqual(["eyes closed", "spike"]);
});

test("stored_by_fingerprint_and_read_back", async () => {
  const a = { id: "a", onset_s: 1, duration_s: 0, label: "spike" };
  const b = { id: "b", onset_s: 2, duration_s: 3, label: "seizure" };
  await saveAnnotations("one", [a]);
  await saveAnnotations("two", [b]);
  expect(await loadAnnotations("one")).toEqual([a]);
  expect(await loadAnnotations("two")).toEqual([b]);
  expect(await loadAnnotations("three")).toEqual([]);
  await saveAnnotations("one", []);
  expect(await loadAnnotations("one")).toEqual([]);
});

test("each_change_is_stored", async () => {
  const fp = "stored";
  const a = create(fp, 1, 0);
  update(fp, a.id, { label: "kept" });
  await new Promise((done) => setTimeout(done, 50));
  expect(await loadAnnotations(fp)).toEqual([{ ...a, label: "kept" }]);
});

test("events_tsv_matches_the_hand_written_file", () => {
  const events = [
    { onset_s: 12.3333333, duration_s: 2.25, label: "seizure onset" },
    { onset_s: 0.5, duration_s: 0, label: "spike" },
    { onset_s: 2.5, duration_s: 1, label: "eyes\tclosed" },
    { onset_s: 20, duration_s: 0, label: "" },
  ].sort((a, b) => a.onset_s - b.onset_s);
  const expected = readFileSync(new URL("./events.expected.tsv", import.meta.url), "utf8");
  expect(eventsTsv(events)).toBe(expected);
  expect(JSON.parse(eventsJson(events))[1]).toEqual({ onset: 2.5, duration: 1, trial_type: "eyes closed" });
});
