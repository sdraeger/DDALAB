import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { beforeEach, expect, test, vi } from "vitest";
import type { AnalysisRecord } from "../core/history";
import { database, listRecent } from "./recent";
import {
  activateRecording,
  type OpenRecording,
  openResult,
  removeRecording,
  setSelection,
  setView,
  showResult,
  useStore,
} from "./store";
import {
  filesSource,
  forgetTab,
  loadTabs,
  matchFiles,
  moveTab,
  remembered,
  saveTabs,
  selectTab,
  shortNames,
  type TabFile,
  tabOpened,
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
  const stores = [...(await database()).objectStoreNames].sort();
  expect(stores).toEqual(["analyses", "annotations", "fileAnnotations", "recent", "tabs"]);
});

const STORES = ["analyses", "annotations", "fileAnnotations", "recent", "tabs"];
const mark = { id: "m", onset_s: 1, duration_s: 0, label: "spike" };

// Two branches each took version 3 for one store: a browser can sit at version 3 with either, and the upgrade adds the
// missing one and keeps the other's records. Version 5 turns a recording's list into a record per annotation.
test.each([
  ["annotations", { fingerprint: "f", annotations: [mark] }, "m", { ...mark, fingerprint: "f" }],
  ["tabs", { tabs: [], active: null }, "open", { tabs: [], active: null }],
] as const)("version_3_with_only_%s_upgrades", async (store, record, key, upgraded) => {
  // The page's connection closes for the delete (recent.ts `blocking`) and opens again after.
  await deleteDB("ddalab");
  const old = await openDB("ddalab", 3, {
    upgrade(db) {
      db.createObjectStore("recent", { keyPath: "fingerprint" });
      db.createObjectStore("analyses", { keyPath: "id" });
      if (store === "annotations") db.createObjectStore(store, { keyPath: "fingerprint" });
      else db.createObjectStore(store);
    },
  });
  await (store === "annotations" ? old.put(store, record) : old.put(store, record, key));
  old.close();
  const db = await database();
  expect([...db.objectStoreNames].sort()).toEqual(STORES);
  expect(await db.get(store, key)).toEqual(upgraded);
});

test("version_4_annotation_lists_become_a_record_each", async () => {
  await deleteDB("ddalab");
  const old = await openDB("ddalab", 4, {
    upgrade(db) {
      for (const name of ["recent", "annotations"]) db.createObjectStore(name, { keyPath: "fingerprint" });
      db.createObjectStore("analyses", { keyPath: "id" });
      db.createObjectStore("tabs");
    },
  });
  const other = { ...mark, id: "n", label: "seizure" };
  await old.put("annotations", { fingerprint: "f", annotations: [mark, other] });
  // An annotation without an id is left out with a warning; the rest of its list upgrades.
  const { id: _, ...unkeyed } = mark;
  await old.put("annotations", { fingerprint: "g", annotations: [unkeyed, { ...mark, id: "o" }] });
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  old.close();
  const db = await database();
  expect([...db.objectStoreNames].sort()).toEqual(STORES);
  expect(await db.getAllFromIndex("annotations", "fingerprint", "f")).toEqual([
    { ...mark, fingerprint: "f" },
    { ...other, fingerprint: "f" },
  ]);
  expect(await db.getAllFromIndex("annotations", "fingerprint", "g")).toEqual([
    { ...mark, id: "o", fingerprint: "g" },
  ]);
  expect(warned).toHaveBeenCalledOnce();
  warned.mockRestore();
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
  // One BIDS name drops its subject and session; names that differ in no entity stay whole.
  expect(shortNames([run("01"), "fixture.edf"])).toEqual([
    "task-ictal_acq-ecog_run-01_ieeg.vhdr",
    "fixture.edf",
  ]);
  expect(shortNames(["sub-01_eeg.edf"])).toEqual(["sub-01_eeg.edf"]);
  expect(shortNames([run("01"), run("01")])).toEqual([run("01"), run("01")]);
});

test("picked_files_match_by_name_and_size", () => {
  const vhdr = file("data/a/fixture.vhdr", 10);
  const eeg = file("data/a/fixture.eeg", 20);
  const edf = file("data/b/fixture.edf", 30);
  // A folder of several recordings: each tab finds its own files, the primary's folder first.
  const picked = [file("data/c/fixture.eeg", 20), vhdr, eeg, edf];
  expect(matchFiles(stored(vhdr, eeg), picked)).toEqual({
    files: [vhdr, eeg],
    primary: "data/a/fixture.vhdr",
    same: true,
  });
  expect(matchFiles(stored(edf), picked)).toEqual({
    files: [edf],
    primary: "data/b/fixture.edf",
    same: true,
  });
  // Another date alone is no reason: the copy matches, for the hash to confirm; one of the same date comes first.
  const copy = file("copy/fixture.edf", 30, 2000);
  expect(matchFiles(stored(edf), [copy])).toEqual({
    files: [copy],
    primary: "copy/fixture.edf",
    same: false,
  });
  expect(matchFiles(stored(edf), [copy, edf])).toMatchObject({ files: [edf], same: true });
  // Another size has changed.
  expect(matchFiles(stored(edf), [file("fixture.edf", 31)])).toEqual({
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
const complete = (id: string, fingerprint: string) =>
  ({ id, fingerprint, status: "complete" }) as AnalysisRecord;

beforeEach(() => {
  useStore.setState({
    recordings: {},
    activeRecordingId: null,
    analyses: [],
    shownResult: null,
    activeResultId: null,
    tabs: [],
    activeTab: null,
    tabReasons: {},
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
  useStore.setState({ analyses: [complete("r", "fa")] });
  openThree();
  expect(useStore.getState().tabs.map((t) => t.fingerprint)).toEqual(["fa", "fb", "fc"]);
  expect(useStore.getState().activeTab).toBe("fc");
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

test("a_switch_is_one_update", () => {
  openThree();
  selectTab("fa");
  setView({ t0: 40, t1: 60 });
  selectTab("fb");
  const seen: { tab: string | null; t0: number }[] = [];
  const stop = useStore.subscribe((s) => seen.push({ tab: s.activeTab, t0: s.view.t0 }));
  selectTab("fa");
  stop();
  expect(seen).toEqual([{ tab: "fa", t0: 40 }]);
});

test("a_run_that_ends_in_another_tab_waits_there", () => {
  openThree();
  selectTab("fa");
  selectTab("fb");
  useStore.setState({ analyses: [complete("r", "fa")] });
  showResult(complete("r", "fa"));
  // B shows nothing of A's result.
  expect(useStore.getState()).toMatchObject({ activeTab: "fb", shownResult: null, activeResultId: null });
  selectTab("fa");
  expect(useStore.getState()).toMatchObject({ shownResult: { id: "r" }, activeResultId: "r" });
  // A run of the tab shown shows at once.
  useStore.setState((s) => ({ analyses: [...s.analyses, complete("q", "fa")] }));
  showResult(complete("q", "fa"));
  expect(useStore.getState()).toMatchObject({ shownResult: { id: "q" }, activeResultId: "q" });
});

test("a_result_opened_while_a_detached_tab_is_selected_shows", () => {
  openThree();
  useStore.setState((s) => ({
    tabs: [...s.tabs, { fingerprint: "fd", name: "fd.edf", source: source("fd.edf") }],
    analyses: [complete("own", "fd"), complete("imported", ""), complete("ra", "fa")],
  }));
  selectTab("fd");
  expect(useStore.getState()).toMatchObject({ activeTab: "fd", activeRecordingId: null });
  // A result of the detached tab shows alone under it.
  openResult("own");
  expect(useStore.getState()).toMatchObject({ activeTab: "fd", shownResult: { id: "own" } });
  // One with no tab shows alone with no tab selected.
  openResult("imported");
  expect(useStore.getState()).toMatchObject({
    activeTab: null,
    activeRecordingId: null,
    shownResult: { id: "imported" },
  });
  // One of an open recording selects its tab.
  openResult("ra");
  expect(useStore.getState()).toMatchObject({
    activeTab: "fa",
    activeRecordingId: "A",
    shownResult: { id: "ra" },
  });
});

test("a_detached_tab_attaches_in_place", () => {
  openThree();
  useStore.setState((s) => ({
    tabs: [...s.tabs, { fingerprint: "fd", name: "fd.edf", source: source("fd.edf") }],
  }));
  selectTab("fd");
  expect(useStore.getState().activeRecordingId).toBeNull();
  // Its recording opens beside the active one: the tab attaches in place and, being selected, shows it.
  useStore.setState((s) => ({ recordings: { ...s.recordings, D: recording("fd") } }));
  tabOpened("D", "fd", "fd.edf", source("fd.edf"));
  expect(useStore.getState()).toMatchObject({ activeRecordingId: "D", activeTab: "fd" });
  expect(useStore.getState().tabs.map((t) => t.fingerprint)).toEqual(["fa", "fb", "fc", "fd"]);
});

test("closing_the_selected_tab_selects_the_next_and_order_moves", () => {
  openThree();
  selectTab("fb");
  forgetTab("fb");
  removeRecording("B");
  expect(useStore.getState()).toMatchObject({ activeTab: "fc", activeRecordingId: "C" });
  moveTab(1, 0);
  expect(useStore.getState().tabs.map((t) => t.fingerprint)).toEqual(["fc", "fa"]);
  // A recording that closes while shown (a detach) can keep its tab selected.
  removeRecording("C", "fc");
  expect(useStore.getState()).toMatchObject({ activeTab: "fc", activeRecordingId: null });
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
  // The synthetic recording is not remembered; the selected tab's view is taken as it is now.
  expect(loaded?.active).toBe("fb");
  expect(loaded?.tabs.map((t) => t.fingerprint)).toEqual(["fa", "fb", "fc"]);
  expect(loaded?.tabs.map((t) => t.saved?.view.t0)).toEqual([20, 50, 0]);
  expect(loaded?.tabs[0].source).toEqual(source("fa.edf"));
  expect(remembered().tabs).toHaveLength(3);
});
