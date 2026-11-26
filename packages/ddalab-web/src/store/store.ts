// The one store. Sample, tile and result arrays never enter it; they live in workers.
import { create } from "zustand";
import type { BatchProgress, BatchRecord } from "../core/batch";
import { type DdaForm, DEFAULT_FORM } from "../core/ddaForm";
import { type Filter, saveFilter, storedFilter } from "../core/filter";
import type { FolderSource } from "../core/folder";
import type { AnalysisRecord } from "../core/history";
import {
  type PanelDrag,
  type ResultDock,
  type RowPlotPosition,
  type SplitRecording,
  saveResultDock,
  saveRowPlotHeight,
  saveRowPlotPosition,
  storedResultDock,
  storedRowPlotHeight,
  storedRowPlotPosition,
} from "../core/layoutSnap";
import type { ScanState } from "../core/protocol";
import type { RunProgress } from "../core/scheduler";
import type { Annotation, RecordingInfo, Reference } from "../core/types";
import type { UserAnnotation } from "../core/userAnnotations";
import type { MapName } from "../render/colormaps";

export type ScaleMode = "full" | "robust" | "custom";
export type RowSort = "channel" | "activity" | "group";

export interface HeatmapOptions {
  scaleMode: ScaleMode;
  customMin: number | null;
  customMax: number | null;
  zScore: boolean;
  sort: RowSort;
  compareResultId: string | null;
}

export const DEFAULT_HEATMAP_OPTIONS: HeatmapOptions = {
  scaleMode: "full",
  customMin: null,
  customMax: null,
  zScore: false,
  sort: "channel",
  compareResultId: null,
};

import { saveTheme, storedTheme, type Theme } from "../styles/theme";
import type { RecentEntry } from "./recent";
import type { Tab, TabView } from "./tabs";

export interface OpenRecording {
  info: RecordingInfo;
  /** Indices into `info.channels` of the display channels, which raw rows and DDA requests index. */
  analysis_channels: number[];
  fingerprint: string;
  scan: ScanState;
  source: "files" | "url" | "synthetic";
  /** Display channels chosen for analysis, as indices into `analysis_channels`, ascending. */
  selectedChannels: number[];
  /**
   * Display channels shown in the waveform viewer (`null`/omitted: all display channels; `[]`: none hidden/empty).
   * Ignored while `view.chosenOnly` is active (which shows `selectedChannels` directly).
   */
  viewedChannels?: number[] | null;
  /** The reference the display channels are derived with; none for the recorded channels. */
  reference?: Reference;
}

export type Epoch = 10 | 20 | 30;
/** The views a phone shows one at a time: the library rail, the waveform, the shown result. */
export type PhoneView = "library" | "waveform" | "results";
export const EPOCHS: Epoch[] = [10, 20, 30];
/** The sensitivity steps of the `[` and `]` keys, in µV/mm: scalp EEG to the millivolts of intracranial contacts. */
export const SENSITIVITIES = [
  1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000,
  10000,
];
/** A voltage in µV as it prints: its number and unit, in mV from 1,000 µV on. */
export const voltage = (uv: number): [number, "µV" | "mV"] => (uv >= 1000 ? [uv / 1000, "mV"] : [uv, "µV"]);
/** CSS pixels in a CSS millimeter. */
export const CSS_PX_PER_MM = 96 / 25.4;
/** The shortest span the view zooms to, in samples. */
export const MIN_SPAN_SAMPLES = 8;

/** What the waveform shows: seconds from the recording start, display channel rows and the physical scale. */
export interface View {
  t0: number;
  t1: number;
  /** The top row on screen, as an index into the rows' channels (`rowChannels`). */
  firstChannel: number;
  /** Rows on screen; fewer while fewer channels show. */
  rowCount: number;
  /** Only the display channels chosen for analysis show, in their order (on only while some are chosen). */
  chosenOnly: boolean;
  epochS: Epoch;
  sensitivityUvPerMm: number;
  /** Physical millimeters in one CSS millimeter on this display (the calibration setting). */
  mmPerCssMm: number;
}

/** The latest DDA run: its progress while it runs, how it ended after. */
export interface RunState {
  /** The result id; empty until the engine has planned the run. */
  id: string;
  recordingId: string;
  status: "running" | "complete" | "failed" | "cancelled";
  progress: RunProgress;
  error?: string;
}

/**
 * The result shown under the waveform, or alone when its recording is not open: the recording it came from, its
 * variant, array and plotted row.
 */
export interface ShownResult {
  id: string;
  fingerprint: string;
  /** `null`: the result's first variant. */
  variant: string | null;
  array: "q" | "fit_error";
  /** The primary row whose line plot is drawn. */
  row: number | null;
  /** Up to 4 rows overlaid in the line plot (Shift-click adds/removes rows). */
  pinnedRows?: number[];
  /** Its analysis interval in seconds, from its record's manifest: it bounds the view while the result shows alone. */
  interval?: { t0: number; t1: number };
}

/** A result's analysis interval, from the manifest its record keeps. */
function intervalOf(record: AnalysisRecord | undefined) {
  const reproduction = record?.manifest?.reproduction;
  return reproduction && { t0: reproduction.start_time_seconds, t1: reproduction.end_time_seconds };
}

/**
 * `next` as an update of `s` in which a result that comes to show alone (no recording active) fills the time axis
 * with its analysis interval, which then bounds the view. One already shown alone keeps its view.
 */
function shownAlone(s: State, next: Partial<State>): Partial<State> {
  const shownResult = next.shownResult === undefined ? s.shownResult : next.shownResult;
  const active = next.activeRecordingId === undefined ? s.activeRecordingId : next.activeRecordingId;
  if (!shownResult || active !== null) return next;
  if (s.activeRecordingId === null && s.shownResult?.id === shownResult.id) return next;
  const interval = shownResult.interval ?? intervalOf(s.analyses.find((a) => a.id === shownResult.id));
  if (!interval) return next;
  return {
    ...next,
    shownResult: { ...shownResult, interval },
    view: { ...(next.view ?? s.view), ...interval },
  };
}

export interface State {
  recordings: Record<string, OpenRecording>;
  activeRecordingId: string | null;
  recent: RecentEntry[];
  /** The analysis history, newest first. */
  analyses: AnalysisRecord[];
  /** The batch runs, newest first, and the one of this page as it goes (core/batch.ts). */
  batches: BatchRecord[];
  batch: BatchProgress | null;
  /** The folder the library shows as a tree, a new `key` each time one is shown, and the batch to resume on it. */
  folder: { source: FolderSource; key: number; resume?: string } | null;
  /** The result the provenance and the result views show; it need not belong to an open recording. */
  activeResultId: string | null;
  /** The side panels: open or collapsed. */
  panels: { library: boolean; inspector: boolean };
  /** The result heatmap's height in CSS pixels as the user set it; null: from its rows. */
  resultHeight: number | null;
  /** The result panel's width in CSS pixels when docked left or right; null: 42% of workspace. */
  resultWidth: number | null;
  /** Where the DDA result panel is docked relative to the waveform pane. */
  resultDock: ResultDock;
  /** Height of the DDA line plot in CSS pixels (resizable with magnetic snap detents). */
  rowPlotHeight: number;
  /** Whether the DDA line plot sits below or above the heatmap. */
  rowPlotPosition: RowPlotPosition;
  /** Secondary open recording snapped into a split pane beside or below the primary recording. */
  splitRecording: SplitRecording | null;
  /** Live panel or tab drag state while dragging to dock or split on the workspace canvas. */
  panelDrag: PanelDrag;
  /** On a phone (a window below 768 px): the one view shown, and whether the inspector covers it. */
  phone: { view: PhoneView; inspector: boolean };
  run: RunState | null;
  shownResult: ShownResult | null;
  /** The DDA settings as the user typed them; the request takes the channels and interval from the recording. */
  ddaForm: DdaForm;
  view: View;
  selection: { t0: number; t1: number } | null;
  cursorS: number | null;
  /** The width of the waveform plot in CSS pixels, which the timebase depends on. */
  plotCssWidth: number;
  /** The theme the user picked; `null` follows the system. */
  theme: Theme | null;
  /** The waveform's display filter, the same for every recording (core/filter.ts). */
  filter: Filter;
  /** The heatmap's color map the user picked, for every result; `null` picks one by the array (`mapOf`). */
  colormap: MapName | null;
  /** Heatmap display options: scale mode (full/robust/custom), row z-score, row sort, and optional B-A diff result. */
  heatmapOptions: HeatmapOptions;
  /** Runs sum basic-flavor windows on WebGPU (core/webgpu.ts) where the browser has an adapter. */
  gpu: boolean;
  /** The open recordings as tabs, in order (tabs.ts). */
  tabs: Tab[];
  /** The selected tab: the active recording's, or a detached one; `null` with none, as for a result shown alone. */
  activeTab: string | null;
  /** Why a detached tab did not reattach, by fingerprint. */
  tabReasons: Record<string, string>;
  /** The user's annotations by recording fingerprint (features/annotations/model.ts). */
  annotations: Record<string, UserAnnotation[]>;
  /** The annotation picked on the ruler or in the list: a user annotation's id, or `file:<index>`. */
  pickedAnnotation: string | null;
  /** The annotation whose editor is open; `created` until its label is first saved. */
  annotationEditor: { id: string; created: boolean } | null;
  /** A user annotation where a drag on the plot has it now, until the drag ends. */
  annotationDraft: UserAnnotation | null;
  /** A new version of the app waits to take over, or took over in another window (app/update.ts). */
  updateReady: boolean;
  /** The last check for a new version (app/update.ts `checkForUpdate`), shown beside the version in About. */
  updateCheck: UpdateCheck;
}

/** `unavailable`: a build without the service worker (dev, e2e), which never updates itself. */
export type UpdateCheck = "idle" | "checking" | "current" | "found" | "failed" | "unavailable";

const CALIBRATION_KEY = "ddalab.mmPerCssMm";
function storedCalibration(): number {
  try {
    const value = Number(localStorage.getItem(CALIBRATION_KEY));
    return value > 0.25 && value < 4 ? value : 1;
  } catch {
    return 1;
  }
}

/** Rows shown at once when a recording opens. */
const DEFAULT_ROWS = 16;

export const useStore = create<State>()(() => ({
  recordings: {},
  activeRecordingId: null,
  recent: [],
  analyses: [],
  batches: [],
  batch: null,
  folder: null,
  activeResultId: null,
  panels: { library: true, inspector: true },
  resultHeight: null,
  resultWidth: null,
  resultDock: storedResultDock(),
  rowPlotHeight: storedRowPlotHeight(),
  rowPlotPosition: storedRowPlotPosition(),
  splitRecording: null,
  panelDrag: null,
  phone: { view: "library", inspector: false },
  run: null,
  shownResult: null,
  ddaForm: DEFAULT_FORM,
  view: {
    t0: 0,
    t1: 10,
    firstChannel: 0,
    rowCount: DEFAULT_ROWS,
    chosenOnly: false,
    epochS: 10,
    sensitivityUvPerMm: 70,
    mmPerCssMm: storedCalibration(),
  },
  selection: null,
  cursorS: null,
  plotCssWidth: 0,
  theme: storedTheme(),
  filter: storedFilter(),
  colormap: storedColormap(),
  heatmapOptions: DEFAULT_HEATMAP_OPTIONS,
  gpu: storedGpu(),
  tabs: [],
  activeTab: null,
  tabReasons: {},
  annotations: {},
  pickedAnnotation: null,
  annotationEditor: null,
  annotationDraft: null,
  updateReady: false,
  updateCheck: "idle",
}));

export const activeRecording = (s: State) =>
  s.activeRecordingId ? s.recordings[s.activeRecordingId] : undefined;

/**
 * The display channels of the waveform's rows, top to bottom:
 * - the DDA-chosen channels while `chosenOnly` is on (and at least one is chosen),
 * - else the user's custom `viewedChannels` subset when set (which may be empty),
 * - else every display channel.
 */
export const rowChannels = (
  { chosenOnly }: Pick<View, "chosenOnly">,
  recording: Pick<OpenRecording, "analysis_channels" | "selectedChannels"> & {
    viewedChannels?: number[] | null;
  },
) => {
  if (chosenOnly && recording.selectedChannels.length > 0) return recording.selectedChannels;
  if (recording.viewedChannels !== undefined && recording.viewedChannels !== null) {
    return recording.viewedChannels;
  }
  return recording.analysis_channels.map((_, i) => i);
};

/**
 * `view` moved inside the recording: whole span in range, at least 8 samples, rows within the channels they show
 * (chosen ones only while some are chosen). Without a
 * recording it stays inside `interval`, the analysis interval of a result shown alone, when there is one, and spans at
 * least a millionth of it (the most windows a result has): a zoom never reaches a span of zero.
 */
function clamp(
  view: View,
  recording: OpenRecording | undefined,
  interval?: { t0: number; t1: number },
): View {
  if (!recording) {
    if (!interval) return view;
    const length = interval.t1 - interval.t0;
    const span = Math.min(length, Math.max(length / 1e6, view.t1 - view.t0));
    const t0 = Math.min(interval.t1 - span, Math.max(interval.t0, view.t0));
    return { ...view, t0, t1: t0 + span };
  }
  const { duration_s: duration, sample_rate_hz: rate } = recording.info;
  const span = Math.min(duration, Math.max(MIN_SPAN_SAMPLES / rate, view.t1 - view.t0));
  const t0 = Math.min(duration - span, Math.max(0, view.t0));
  // The row count is held against all channels: it comes back when every channel shows again.
  const rowCount = Math.max(1, Math.min(recording.analysis_channels.length, Math.round(view.rowCount)));
  const chosenOnly = view.chosenOnly && recording.selectedChannels.length > 0;
  const shown = rowChannels({ chosenOnly }, recording).length;
  const firstChannel =
    shown === 0 ? 0 : Math.max(0, Math.min(shown - Math.min(rowCount, shown), Math.round(view.firstChannel)));
  return { ...view, t0, t1: t0 + span, rowCount, firstChannel, chosenOnly };
}

/**
 * `next`, a view of `recording` whose rows were the channels `rows` from `first`: its top row keeps its channel, or
 * the first channel after it that shows.
 */
function keepTop(rows: number[], first: number, next: View, recording: OpenRecording): View {
  const shown = rowChannels(next, recording);
  const at = shown.findIndex((c) => c >= (rows[first] ?? 0));
  return clamp({ ...next, firstChannel: at < 0 ? shown.length : at }, recording);
}

/** The first epoch and the first rows of `recording`; scale settings carry over. */
function freshView(
  view: View,
  recording: OpenRecording | undefined,
): Pick<State, "view" | "selection" | "cursorS"> {
  const next = {
    ...view,
    t0: 0,
    t1: view.epochS,
    firstChannel: 0,
    rowCount: DEFAULT_ROWS,
    chosenOnly: false,
  };
  return { view: clamp(next, recording), selection: null, cursorS: null };
}

/** What the selected tab keeps while another is shown; a detached tab keeps its view and takes its result along. */
export function tabViewOf(s: State, kept?: TabView): TabView {
  const recording = activeRecording(s);
  const { mmPerCssMm: _, ...view } = s.view;
  const result = { shownResult: s.shownResult, activeResultId: s.activeResultId };
  if (recording)
    return {
      view,
      selection: s.selection,
      selectedChannels: recording.selectedChannels,
      viewedChannels: recording.viewedChannels,
      ...result,
    };
  const first = {
    ...view,
    t0: 0,
    t1: view.epochS,
    firstChannel: 0,
    rowCount: DEFAULT_ROWS,
    chosenOnly: false,
  };
  return { ...(kept ?? { view: first, selection: null, selectedChannels: [] }), ...result };
}

/**
 * The tab of `fingerprint` selected, as one update: the selected tab keeps its view and the tab entered gets its own
 * back, or its recording's first epoch the first time. `change` is what the update also changes (a recording added or
 * removed, the tab list); `result` is a result the switch opens.
 */
export function enter(
  s: State,
  fingerprint: string | null,
  change: Partial<Pick<State, "recordings" | "tabs">> = {},
  result?: Pick<State, "shownResult" | "activeResultId">,
): Partial<State> {
  const tabs = (change.tabs ?? s.tabs).map((t) =>
    t.fingerprint === s.activeTab ? { ...t, saved: tabViewOf(s, t.saved) } : t,
  );
  const all = change.recordings ?? s.recordings;
  const id = Object.keys(all).find((k) => all[k].fingerprint === fingerprint) ?? null;
  const recording = id === null ? undefined : all[id];
  const saved = tabs.find((t) => t.fingerprint === fingerprint)?.saved;
  const complete = (resultId?: string | null) =>
    s.analyses.some((a) => a.id === resultId && a.status === "complete");
  const channels = recording?.analysis_channels.length ?? 0;
  const restored =
    recording && saved
      ? {
          ...recording,
          selectedChannels: saved.selectedChannels.filter((c) => c < channels),
          viewedChannels:
            saved.viewedChannels !== undefined && saved.viewedChannels !== null
              ? saved.viewedChannels.filter((c) => c < channels)
              : null,
        }
      : recording;
  const recordings = id !== null && restored && saved ? { ...all, [id]: restored } : all;
  const splitRecording =
    s.splitRecording &&
    s.splitRecording.fingerprint !== fingerprint &&
    tabs.some((t) => t.fingerprint === s.splitRecording?.fingerprint)
      ? s.splitRecording
      : null;
  return shownAlone(s, {
    tabs,
    recordings,
    splitRecording,
    activeTab: fingerprint,
    activeRecordingId: id,
    // A view saved by 2.0.0 has no chosenOnly: it shows every channel.
    view: saved
      ? clamp({ ...s.view, ...saved.view, chosenOnly: saved.view.chosenOnly ?? false }, restored)
      : freshView(s.view, recording).view,
    selection: saved?.selection ?? null,
    cursorS: null,
    // The annotation UI belongs to the recording left: its pick, open editor and drag end with the switch.
    pickedAnnotation: null,
    annotationEditor: null,
    annotationDraft: null,
    ...(result ?? {
      shownResult: complete(saved?.shownResult?.id) ? (saved?.shownResult ?? null) : null,
      activeResultId: s.analyses.some((a) => a.id === saved?.activeResultId)
        ? (saved?.activeResultId ?? null)
        : null,
    }),
  });
}

/** Adds a freshly opened recording, which nothing has scanned yet: the active one unless `activate` is false. */
export function addRecording(
  id: string,
  recording: Omit<OpenRecording, "scan" | "selectedChannels" | "viewedChannels">,
  activate = true,
) {
  const scan: ScanState = { scannedRows: 0, totalRows: recording.info.sample_count };
  const added: OpenRecording = { ...recording, scan, selectedChannels: [], viewedChannels: null };
  useStore.setState((s) => {
    const recordings = { ...s.recordings, [id]: added };
    return activate ? enter(s, added.fingerprint, { recordings }) : { recordings };
  });
}

/**
 * Recording `id` with the channels of `reference`: they replace its display channels, so the channels chosen for
 * analysis start over and the scan starts again.
 */
export function setReferenced(
  id: string,
  opened: { info: RecordingInfo; analysis_channels: number[] },
  reference: Reference | undefined,
) {
  useStore.setState((s) => {
    const recording = s.recordings[id];
    if (!recording) return s;
    const scan: ScanState = { scannedRows: 0, totalRows: opened.info.sample_count };
    const updated = { ...recording, ...opened, reference, scan, selectedChannels: [], viewedChannels: null };
    return { recordings: { ...s.recordings, [id]: updated } };
  });
}

/** Makes an open recording the active one, with its tab's view. */
export function activateRecording(id: string) {
  useStore.setState((s) =>
    s.recordings[id] && s.activeRecordingId !== id ? enter(s, s.recordings[id].fingerprint) : s,
  );
}

/**
 * Drops a recording. When it was the active one, `select` is the tab shown instead: by default the next tab, else the
 * previous one.
 */
export function removeRecording(id: string, select?: string | null) {
  useStore.setState((s) => {
    const { [id]: removed, ...recordings } = s.recordings;
    if (s.activeRecordingId !== id) return { recordings };
    const i = s.tabs.findIndex((t) => t.fingerprint === removed?.fingerprint);
    const next = (i < 0 ? undefined : (s.tabs[i + 1] ?? s.tabs[i - 1]))?.fingerprint ?? null;
    return enter(s, select === undefined ? next : select, { recordings });
  });
}

/** Replaces the scan state of an open recording. */
export function setScan(id: string, scan: ScanState) {
  useStore.setState((s) => {
    const found = s.recordings[id];
    return found ? { recordings: { ...s.recordings, [id]: { ...found, scan } } } : s;
  });
}

/** The full annotation list replaces the one `open` returned; its warnings join the recording's. */
export function setAnnotations(id: string, found: { annotations: Annotation[]; warnings: string[] }) {
  useStore.setState((s) => {
    const recording = s.recordings[id];
    if (!recording) return s;
    const warnings = [...new Set([...recording.info.warnings, ...found.warnings])];
    const info = { ...recording.info, annotations: found.annotations, warnings };
    return { recordings: { ...s.recordings, [id]: { ...recording, info } } };
  });
}

/** Replaces the active recording's DDA channel choice with `channels` (deduped, bounded, ascending). */
export function setSelectedChannels(channels: number[]) {
  useStore.setState((s) => {
    const recording = activeRecording(s);
    if (!recording || !s.activeRecordingId) return s;
    const limit = recording.analysis_channels.length;
    const next = [...new Set(channels.filter((c) => c >= 0 && c < limit))].sort((a, b) => a - b);
    const updated = { ...recording, selectedChannels: next };
    const recordings = { ...s.recordings, [s.activeRecordingId]: updated };
    if (!s.view.chosenOnly) return { recordings };
    return {
      recordings,
      view: keepTop(rowChannels(s.view, recording), s.view.firstChannel, s.view, updated),
    };
  });
}

/** Selects every display channel of the active recording for DDA analysis. */
export function selectAllChannels() {
  const recording = activeRecording(useStore.getState());
  if (!recording) return;
  setSelectedChannels(recording.analysis_channels.map((_, i) => i));
}

/** Clears all channels selected for DDA analysis on the active recording. */
export function clearSelectedChannels() {
  setSelectedChannels([]);
}

/**
 * Sets which display channels are shown in the waveform viewer (`null` or every channel shows all).
 * Turns off `chosenOnly` so the explicit view change takes effect immediately.
 */
export function setViewedChannels(channels: number[] | null) {
  useStore.setState((s) => {
    const recording = activeRecording(s);
    if (!recording || !s.activeRecordingId) return s;
    const limit = recording.analysis_channels.length;
    let next: number[] | null = null;
    if (channels !== null) {
      const sorted = [...new Set(channels.filter((c) => c >= 0 && c < limit))].sort((a, b) => a - b);
      next = sorted.length === limit ? null : sorted;
    }
    const updated = { ...recording, viewedChannels: next };
    const recordings = { ...s.recordings, [s.activeRecordingId]: updated };
    const prevRows = rowChannels(s.view, recording);
    return {
      recordings,
      view: keepTop(prevRows, s.view.firstChannel, { ...s.view, chosenOnly: false }, updated),
    };
  });
}

/** Shows (`on`) or hides display channels in the waveform viewer, independent of DDA selection. */
export function toggleViewedChannels(channels: number[], on: boolean) {
  const state = useStore.getState();
  const recording = activeRecording(state);
  if (!recording) return;
  // When `chosenOnly` is active, start from the currently visible rows so hiding/showing feels continuous.
  const base =
    state.view.chosenOnly && recording.selectedChannels.length > 0
      ? recording.selectedChannels
      : (recording.viewedChannels ?? recording.analysis_channels.map((_, i) => i));
  const next = new Set(base);
  for (const c of channels) {
    if (on) next.add(c);
    else next.delete(c);
  }
  setViewedChannels([...next]);
}

/**
 * Adds (`on`) or removes display channels from the active recording's analysis choice. While only the chosen channels
 * show, the rows follow the choice; with none left every channel shows.
 */
export function selectChannels(channels: number[], on: boolean) {
  useStore.setState((s) => {
    const recording = activeRecording(s);
    if (!recording || !s.activeRecordingId) return s;
    const chosen = new Set(recording.selectedChannels);
    for (const c of channels) {
      if (on) chosen.add(c);
      else chosen.delete(c);
    }
    const updated = { ...recording, selectedChannels: [...chosen].sort((a, b) => a - b) };
    const recordings = { ...s.recordings, [s.activeRecordingId]: updated };
    if (!s.view.chosenOnly) return { recordings };
    return {
      recordings,
      view: keepTop(rowChannels(s.view, recording), s.view.firstChannel, s.view, updated),
    };
  });
}

/** Shows only the display channels chosen for analysis (`on`), or all of them; the top row keeps its channel. */
export function showChosenOnly(on: boolean) {
  useStore.setState((s) => {
    const recording = activeRecording(s);
    if (!recording) return s;
    const rows = rowChannels(s.view, recording);
    return { view: keepTop(rows, s.view.firstChannel, { ...s.view, chosenOnly: on }, recording) };
  });
}

/** Changes the view; it stays inside the active recording. */
export function setView(change: Partial<View> | ((view: View) => Partial<View>)) {
  useStore.setState((s) => {
    const next = { ...s.view, ...(typeof change === "function" ? change(s.view) : change) };
    return { view: clamp(next, activeRecording(s), s.shownResult?.interval) };
  });
}

/** The page the view starts in and the pages of the recording; a view that reaches the end is on the last page. */
export function pageOf(view: View, duration: number): [page: number, pages: number] {
  const pages = Math.max(1, Math.ceil(duration / view.epochS - 1e-6));
  const page = view.t1 >= duration - 1e-6 ? pages : Math.floor(view.t0 / view.epochS + 1e-6) + 1;
  return [Math.min(page, pages), pages];
}

/** Moves the view by `epochs` epochs; the last page ends at the end of the recording. */
export const pageBy = (epochs: number) =>
  setView((v) => ({ t0: v.t0 + epochs * v.epochS, t1: v.t1 + epochs * v.epochS }));

export const pageToStart = () => setView((v) => ({ t0: 0, t1: v.t1 - v.t0 }));
export function pageToEnd() {
  const end = activeRecording(useStore.getState())?.info.duration_s;
  if (end !== undefined) setView((v) => ({ t0: end - (v.t1 - v.t0), t1: end }));
}

/** Scales the span by `factor` about `atS`, which keeps its place on screen. */
export const zoomBy = (factor: number, atS: number) =>
  setView((v) => ({ t0: atS - (atS - v.t0) * factor, t1: atS + (v.t1 - atS) * factor }));

/** One step along `SENSITIVITIES` from the step nearest the current value. */
export function stepSensitivity(steps: number) {
  setView((v) => {
    const nearest = SENSITIVITIES.reduce(
      (best, s, i) =>
        Math.abs(s - v.sensitivityUvPerMm) < Math.abs(SENSITIVITIES[best] - v.sensitivityUvPerMm) ? i : best,
      0,
    );
    const i = Math.max(0, Math.min(SENSITIVITIES.length - 1, nearest + steps));
    return { sensitivityUvPerMm: SENSITIVITIES[i] };
  });
}

/** The epoch becomes the span from the current start. */
export const setEpoch = (epochS: Epoch) => setView((v) => ({ epochS, t1: v.t0 + epochS }));

/** Physical millimeters per second across the plot. */
export const timebaseOf = (view: View, plotCssWidth: number) =>
  ((plotCssWidth / CSS_PX_PER_MM) * view.mmPerCssMm) / (view.t1 - view.t0);

/** Sets the span that gives `mmPerS` across the current plot width. */
export function setTimebase(mmPerS: number) {
  const { plotCssWidth } = useStore.getState();
  if (plotCssWidth > 0)
    setView((v) => ({ t1: v.t0 + ((plotCssWidth / CSS_PX_PER_MM) * v.mmPerCssMm) / mmPerS }));
}

export function setCalibration(mmPerCssMm: number) {
  try {
    localStorage.setItem(CALIBRATION_KEY, String(mmPerCssMm));
  } catch {}
  setView({ mmPerCssMm });
}

export const setDdaForm = (change: Partial<DdaForm>) =>
  useStore.setState((s) => ({ ddaForm: { ...s.ddaForm, ...change } }));

/**
 * Opens the result `id` (`null` closes it): its provenance, and its views once its record says it is complete. The
 * views start from its first variant; the result already shown keeps its variant, array and row. The open recording
 * the result came from becomes the active one. With none open (an imported result has no fingerprint) no recording
 * is active and the views show alone.
 */
export const openResult = (id: string | null) =>
  useStore.setState((s): Partial<State> => {
    const record = s.analyses.find((a) => a.id === id);
    if (id === null || record?.status !== "complete") return { activeResultId: id, shownResult: null };
    const shownResult: ShownResult =
      s.shownResult?.id === id
        ? s.shownResult
        : {
            id,
            fingerprint: record.fingerprint,
            variant: null,
            array: "q",
            row: null,
            interval: intervalOf(record),
          };
    // Its own tab, attached or detached, or none: a detached tab shows it alone under its reattach line.
    const known = (fp: string) =>
      s.tabs.some((t) => t.fingerprint === fp) ||
      Object.values(s.recordings).some((r) => r.fingerprint === fp);
    const own = known(record.fingerprint) ? record.fingerprint : null;
    if (own === s.activeTab) return shownAlone(s, { activeResultId: id, shownResult });
    return enter(s, own, {}, { activeResultId: id, shownResult });
  });

/**
 * Opens the complete result of `record`, which has just finished, with or without a history. The result of a tab that
 * is not shown waits in that tab's view; with its tab closed it is in the history only. `interval` stands in for the
 * one its manifest gives, when the record has none.
 */
export const showResult = (record: AnalysisRecord, interval = intervalOf(record)) =>
  useStore.setState((s) => {
    const { id, fingerprint } = record;
    const shownResult: ShownResult = { id, fingerprint, variant: null, array: "q", row: null, interval };
    if (s.activeTab === fingerprint) return shownAlone(s, { activeResultId: id, shownResult });
    return {
      tabs: s.tabs.map((t) =>
        t.fingerprint === fingerprint && t.saved
          ? { ...t, saved: { ...t.saved, shownResult, activeResultId: id } }
          : t,
      ),
    };
  });

/** Shows `source` as the library's folder tree, to resume the batch `resume` on. Another folder drops the last batch's
 * outcome and marks; a batch still running keeps its progress. */
export const showFolder = (source: FolderSource, resume?: string) =>
  useStore.setState((s) => ({
    folder: { source, key: (s.folder?.key ?? 0) + 1, resume },
    ...(s.batch?.status !== "running" && { batch: null }),
  }));
export const closeFolder = () => useStore.setState({ folder: null });

export const setShownResult = (change: Partial<ShownResult>) =>
  useStore.setState((s) => {
    if (!s.shownResult) return { shownResult: null };
    const next = { ...s.shownResult, ...change };
    if ("row" in change && !("pinnedRows" in change)) {
      next.pinnedRows = change.row === null || change.row === undefined ? [] : [change.row];
    }
    return { shownResult: next };
  });

/** Toggles `row` in the multi-row line plot (up to 4 pinned rows). */
export const togglePinnedRow = (row: number) =>
  useStore.setState((s) => {
    if (!s.shownResult) return { shownResult: null };
    const prev =
      s.shownResult.pinnedRows && s.shownResult.pinnedRows.length > 0
        ? s.shownResult.pinnedRows
        : s.shownResult.row !== null
          ? [s.shownResult.row]
          : [];
    const next = prev.includes(row) ? prev.filter((r) => r !== row) : [...prev, row].slice(-4);
    return {
      shownResult: {
        ...s.shownResult,
        pinnedRows: next,
        row: next.length > 0 ? next[next.length - 1] : null,
      },
    };
  });

export const setHeatmapOptions = (change: Partial<HeatmapOptions>) =>
  useStore.setState((s) => ({ heatmapOptions: { ...s.heatmapOptions, ...change } }));

export const setResultHeight = (resultHeight: number | null) => useStore.setState({ resultHeight });
export const setResultWidth = (resultWidth: number | null) => useStore.setState({ resultWidth });

export function setResultDock(resultDock: ResultDock) {
  saveResultDock(resultDock);
  useStore.setState({ resultDock });
}

export function setRowPlotHeight(rowPlotHeight: number) {
  const clamped = Math.round(Math.max(56, Math.min(320, rowPlotHeight)));
  saveRowPlotHeight(clamped);
  useStore.setState({ rowPlotHeight: clamped });
}

export function setRowPlotPosition(rowPlotPosition: RowPlotPosition) {
  saveRowPlotPosition(rowPlotPosition);
  useStore.setState({ rowPlotPosition });
}

export function setSplitRecording(splitRecording: SplitRecording | null) {
  useStore.setState((s) => {
    if (!splitRecording) return { splitRecording: null };
    if (splitRecording.fingerprint === s.activeTab) return { splitRecording: null };
    return {
      splitRecording: {
        ...splitRecording,
        ratio: Math.max(0.25, Math.min(0.75, splitRecording.ratio)),
      },
    };
  });
}

export const closeSplitRecording = () => useStore.setState({ splitRecording: null });

export function swapSplitRecordings() {
  useStore.setState((s) => {
    const split = s.splitRecording;
    if (!split || !s.activeTab || split.fingerprint === s.activeTab) return s;
    return {
      ...enter(s, split.fingerprint),
      splitRecording: { ...split, fingerprint: s.activeTab },
    };
  });
}

export const setPanelDrag = (panelDrag: PanelDrag) => useStore.setState({ panelDrag });

export const togglePanel = (panel: keyof State["panels"]) =>
  useStore.setState((s) => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } }));

/** Shows a view on a phone; the inspector, which covers the view, closes. */
export const showPhoneView = (view: PhoneView) => useStore.setState({ phone: { view, inspector: false } });
export const togglePhoneInspector = () =>
  useStore.setState((s) => ({ phone: { ...s.phone, inspector: !s.phone.inspector } }));

export const setSelection = (selection: State["selection"]) => useStore.setState({ selection });
export const setCursor = (cursorS: number | null) => useStore.setState({ cursorS });
export const setPlotWidth = (plotCssWidth: number) => useStore.setState({ plotCssWidth });

export function setFilter(change: Partial<Filter>) {
  const filter = { ...useStore.getState().filter, ...change };
  saveFilter(filter);
  useStore.setState({ filter });
}

const GPU_KEY = "ddalab.gpu";

/** Whether the GPU was last chosen for runs; off without storage. */
function storedGpu(): boolean {
  try {
    return localStorage.getItem(GPU_KEY) === "on";
  } catch {
    return false;
  }
}

export function setGpu(gpu: boolean) {
  try {
    localStorage.setItem(GPU_KEY, gpu ? "on" : "off");
  } catch {
    // without storage the choice lasts this visit
  }
  useStore.setState({ gpu });
}

const COLORMAP_KEY = "ddalab.colormap";

/** The color map last picked, which localStorage keeps; `null` without one, or without storage. */
function storedColormap(): MapName | null {
  try {
    return (localStorage.getItem(COLORMAP_KEY) as MapName | null) ?? null;
  } catch {
    return null;
  }
}

export function setColormap(colormap: MapName | null) {
  try {
    if (colormap) localStorage.setItem(COLORMAP_KEY, colormap);
    else localStorage.removeItem(COLORMAP_KEY);
  } catch {}
  useStore.setState({ colormap });
}

export function setTheme(theme: Theme | null) {
  saveTheme(theme);
  useStore.setState({ theme });
}
