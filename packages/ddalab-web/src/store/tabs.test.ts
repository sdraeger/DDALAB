import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, expect, test } from "vitest";
import type { AnalysisRecord } from "../core/history";
import { listRecent } from "./recent";
import { activateRecording, type OpenRecording, openResult, setSelection, setView, useStore } from "./store";
import {
  filesSource,
  forgetTab,
  loadTabs,
  matchFiles,
  remembered,
  saveTabs,
  selectTab,
  shortNames,
  type TabFile,
  tabOpened,
  useTabs,
} from "./tabs";

// Runs first: the database of the last release, version 2, upgrades in place.
test("version_2_database_upgrades_with_its_recent_list", async () => {
  const old = await openDB("ddalab", 2, {
    upgrade(db) {
      db.createObjectStore("recent", { keyPath: "fingerprint" });
      db.createObjectStore("analyses", { keyPath: "id" });
    },
  });
  await old.put("recent", { fingerprint: "f", primary: "a.edf", names: ["a.edf"], lastOpened: 1 });
  await old.put("analyses", { id: "r1", fingerprint: "f", status: "complete" });
  old.close();
  expect(await loadTabs()).toBeUndefined();
  expect(await listRecent()).toEqual([
    { fingerprint: "f", primary: "a.edf", names: ["a.edf"], lastOpened: 1 },
  ]);
});

const file = (path: string, size: number, lastModified = 1000) => {
  const name = path.split("/").at(-1) as string;
  const found = new File([new Uint8Array(size)], name, { lastModified });
  if (path.includes("/")) Object.defineProperty(found, "webkitRelativePath", { value: path });
  return found;
};
const stored = (...files: File[]): TabFile[] =>
  files.map((f) => ({
    path: f.webkitRelativePath || f.name,
    name: f.name,
    size: f.size,
    lastModified: 1000,
  }));

test("bids_names_drop_shared_entities", () => {
  const run = (n: string) => `sub-pt01_ses-presurgery_task-ictal_acq-ecog_run-${n}_ieeg.vhdr`;
  expect(shortNames([run("01"), run("02"), "fixture.edf"])).toEqual([
    "run-01_ieeg.vhdr",
    "run-02_ieeg.vhdr",
    "fixture.edf",
  ]);
  expect(shortNames(["sub-01_task-rest_eeg.edf", "sub-02_task-rest_eeg.edf"])).toEqual([
    "sub-01_eeg.edf",
    "sub-02_eeg.edf",
  ]);
  // One BIDS name, or names that differ in no entity, stay whole.
  expect(shortNames([run("01"), "fixture.edf"])).toEqual([run("01"), "fixture.edf"]);
  expect(shortNames([run("01"), run("01")])).toEqual([run("01"), run("01")]);
});

test("picked_files_match_by_name_size_and_date", () => {
  const vhdr = file("data/a/fixture.vhdr", 10);
  const eeg = file("data/a/fixture.eeg", 20);
  const edf = file("data/b/fixture.edf", 30);
  // A folder of several recordings: each tab finds its own files, the primary's folder first.
  const picked = [file("data/c/fixture.eeg", 20), vhdr, eeg, edf];
  expect(matchFiles(stored(vhdr, eeg), picked)).toEqual({
    files: [vhdr, eeg],
    primary: "data/a/fixture.vhdr",
  });
  expect(matchFiles(stored(edf), picked)).toEqual({ files: [edf], primary: "data/b/fixture.edf" });
  // A file that changed size or date stays detached, with the reason.
  expect(matchFiles(stored(edf), [file("fixture.edf", 31)])).toEqual({
    reason: "fixture.edf changed since it was opened",
  });
  expect(matchFiles(stored(edf), [file("fixture.edf", 30, 2000)])).toEqual({
    reason: "fixture.edf changed since it was opened",
  });
  // A folder that holds part of a recording, or none of it.
  expect(matchFiles(stored(vhdr, eeg, file("fixture.vmrk", 5)), [vhdr])).toEqual({
    reason: "fixture.eeg, fixture.vmrk are not among the chosen files",
  });
  expect(matchFiles(stored(edf), [vhdr, eeg])).toBeNull();
});

test("files_source_keeps_the_used_files_primary_first", () => {
  const vhdr = file("data/fixture.vhdr", 10);
  const eeg = file("data/fixture.eeg", 20);
  const other = file("data/other.edf", 5);
  const root = { kind: "directory", name: "data" } as FileSystemDirectoryHandle;
  const source = filesSource([eeg, other, vhdr], ["fixture.vhdr", "fixture.eeg"], { root });
  expect(source).toEqual({
    kind: "files",
    root,
    files: [
      { path: "data/fixture.vhdr", name: "fixture.vhdr", size: 10, lastModified: 1000, handle: undefined },
      { path: "data/fixture.eeg", name: "fixture.eeg", size: 20, lastModified: 1000, handle: undefined },
    ],
  });
  // A folder handle covers only files under it.
  expect(filesSource([file("fixture.edf", 3)], ["fixture.edf"], { root })).toMatchObject({ root: undefined });
});

const recording = (fingerprint: string, duration = 100) =>
  ({
    fingerprint,
    info: { duration_s: duration, sample_rate_hz: 100, input_files: [`${fingerprint}.edf`] },
    analysis_channels: [0, 1, 2],
    selectedChannels: [],
  }) as unknown as OpenRecording;
const source = (name: string) => ({ kind: "files" as const, files: stored(file(name, 1)) });
const viewOf = () => {
  const { t0, t1, epochS } = useStore.getState().view;
  return { t0, t1, epochS };
};

beforeEach(() => {
  useTabs.setState({ tabs: [], active: null, reasons: {} });
  useStore.setState({
    recordings: {},
    activeRecordingId: null,
    analyses: [],
    shownResult: null,
    activeResultId: null,
  });
});

/** Opens recordings A, B and C as the app does: each joins the store and its tab, and the last is active. */
function openThree() {
  for (const [id, fp] of [
    ["A", "fa"],
    ["B", "fb"],
    ["C", "fc"],
  ]) {
    useStore.setState((s) => ({ recordings: { ...s.recordings, [id]: recording(fp) } }));
    activateRecording(id);
    tabOpened(id, fp, `${fp}.edf`, source(`${fp}.edf`));
  }
}

test("each_tab_keeps_its_view", () => {
  useStore.setState({ analyses: [{ id: "r", fingerprint: "fa", status: "complete" } as AnalysisRecord] });
  openThree();
  expect(useTabs.getState().tabs.map((t) => t.fingerprint)).toEqual(["fa", "fb", "fc"]);
  expect(useTabs.getState().active).toBe("fc");
  selectTab("fa");
  setView({ t0: 40, t1: 60 });
  setSelection({ t0: 42, t1: 45 });
  useStore.setState((s) => ({
    recordings: { ...s.recordings, A: { ...s.recordings.A, selectedChannels: [0, 2] } },
  }));
  openResult("r");
  useStore.setState((s) => ({ shownResult: s.shownResult && { ...s.shownResult, row: 1 } }));
  selectTab("fb");
  // B comes back as it was left: at its first epoch, with no selection or result.
  expect(viewOf()).toMatchObject({ t0: 0, t1: 10 });
  expect(useStore.getState()).toMatchObject({ selection: null, shownResult: null, activeResultId: null });
  setView({ t0: 70, t1: 90 });
  selectTab("fa");
  expect(viewOf()).toMatchObject({ t0: 40, t1: 60 });
  expect(useStore.getState()).toMatchObject({
    selection: { t0: 42, t1: 45 },
    shownResult: { id: "r", row: 1 },
    activeResultId: "r",
    recordings: { A: { selectedChannels: [0, 2] } },
  });
  selectTab("fb");
  expect(viewOf()).toMatchObject({ t0: 70, t1: 90 });
});

test("opening_a_result_switches_with_that_result", () => {
  useStore.setState({ analyses: [{ id: "r", fingerprint: "fa", status: "complete" } as AnalysisRecord] });
  openThree();
  openResult("r");
  expect(useStore.getState()).toMatchObject({ activeRecordingId: "A", shownResult: { id: "r" } });
  expect(useTabs.getState().active).toBe("fa");
});

test("a_detached_tab_leaves_no_recording_active", () => {
  openThree();
  useTabs.setState((s) => ({
    tabs: [...s.tabs, { fingerprint: "fd", name: "fd.edf", source: source("fd.edf") }],
  }));
  selectTab("fd");
  expect(useStore.getState().activeRecordingId).toBeNull();
  expect(useTabs.getState().active).toBe("fd");
  // Its recording opens: the tab attaches in place and shows it.
  useStore.setState((s) => ({ recordings: { ...s.recordings, D: recording("fd") } }));
  tabOpened("D", "fd", "fd.edf", source("fd.edf"));
  expect(useStore.getState().activeRecordingId).toBe("D");
  expect(useTabs.getState().tabs.map((t) => t.fingerprint)).toEqual(["fa", "fb", "fc", "fd"]);
});

test("closing_the_active_tab_activates_the_next", () => {
  openThree();
  selectTab("fb");
  forgetTab("fb");
  expect(useTabs.getState().active).toBe("fc");
  expect(useStore.getState().activeRecordingId).toBe("C");
  forgetTab("fc");
  expect(useTabs.getState().active).toBe("fa");
  expect(useTabs.getState().tabs.map((t) => t.fingerprint)).toEqual(["fa"]);
});

test("the_open_set_round_trips_with_each_view", async () => {
  openThree();
  useStore.setState((s) => ({ recordings: { ...s.recordings, S: recording("fs") } }));
  tabOpened("S", "fs", "synthetic.edf", null);
  selectTab("fa");
  setView({ t0: 20, t1: 30 });
  selectTab("fb");
  setView({ t0: 50, t1: 60 });
  await saveTabs();
  const loaded = await loadTabs();
  // The synthetic recording is not remembered; the active tab's view is taken as it is now.
  expect(loaded?.active).toBe("fb");
  expect(loaded?.tabs.map((t) => t.fingerprint)).toEqual(["fa", "fb", "fc"]);
  expect(loaded?.tabs.map((t) => t.saved?.view.t0)).toEqual([20, 50, 0]);
  expect(loaded?.tabs[0].source).toEqual(source("fa.edf"));
  expect(remembered().tabs).toHaveLength(3);
});
