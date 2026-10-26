// The one store. Sample, tile and result arrays never enter it; they live in workers.
import { create } from "zustand";
import type { AnalysisRecord } from "../core/history";
import type { ScanState } from "../core/protocol";
import type { RunProgress } from "../core/scheduler";
import type { Annotation, RecordingInfo } from "../core/types";
import type { UserAnnotation } from "../core/userAnnotations";
import { type DdaForm, DEFAULT_FORM } from "../features/analysis/validate";
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
}

export type Epoch = 10 | 20 | 30;
export const EPOCHS: Epoch[] = [10, 20, 30];
/** The sensitivity steps of the `[` and `]` keys, in µV/mm. */
export const SENSITIVITIES = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100];
/** CSS pixels in a CSS millimetre. */
export const CSS_PX_PER_MM = 96 / 25.4;
/** The shortest span the view zooms to, in samples. */
export const MIN_SPAN_SAMPLES = 8;

/** What the waveform shows: seconds from the recording start, display channel rows and the physical scale. */
export interface View {
  t0: number;
  t1: number;
  firstChannel: number;
  rowCount: number;
  epochS: Epoch;
  sensitivityUvPerMm: number;
  /** Physical millimetres in one CSS millimetre on this display (the calibration setting). */
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
  /** The row whose line plot is drawn. */
  row: number | null;
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
  /** The result the provenance and the result views show; it need not belong to an open recording. */
  activeResultId: string | null;
  /** The side panels: open or collapsed. */
  panels: { library: boolean; inspector: boolean };
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
}

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
  activeResultId: null,
  panels: { library: true, inspector: true },
  run: null,
  shownResult: null,
  ddaForm: DEFAULT_FORM,
  view: {
    t0: 0,
    t1: 10,
    firstChannel: 0,
    rowCount: DEFAULT_ROWS,
    epochS: 10,
    sensitivityUvPerMm: 70,
    mmPerCssMm: storedCalibration(),
  },
  selection: null,
  cursorS: null,
  plotCssWidth: 0,
  theme: storedTheme(),
  tabs: [],
  activeTab: null,
  tabReasons: {},
  annotations: {},
  pickedAnnotation: null,
  annotationEditor: null,
  annotationDraft: null,
  updateReady: false,
}));

export const activeRecording = (s: State) =>
  s.activeRecordingId ? s.recordings[s.activeRecordingId] : undefined;

/**
 * `view` moved inside the recording: whole span in range, at least 8 samples, rows within the channels. Without a
 * recording it stays inside `interval`, the analysis interval of a result shown alone, when there is one.
 */
function clamp(
  view: View,
  recording: OpenRecording | undefined,
  interval?: { t0: number; t1: number },
): View {
  if (!recording) {
    if (!interval) return view;
    const span = Math.min(interval.t1 - interval.t0, view.t1 - view.t0);
    const t0 = Math.min(interval.t1 - span, Math.max(interval.t0, view.t0));
    return { ...view, t0, t1: t0 + span };
  }
  const { duration_s: duration, sample_rate_hz: rate } = recording.info;
  const channels = recording.analysis_channels.length;
  const span = Math.min(duration, Math.max(MIN_SPAN_SAMPLES / rate, view.t1 - view.t0));
  const t0 = Math.min(duration - span, Math.max(0, view.t0));
  const rowCount = Math.max(1, Math.min(channels, Math.round(view.rowCount)));
  const firstChannel = Math.max(0, Math.min(channels - rowCount, Math.round(view.firstChannel)));
  return { ...view, t0, t1: t0 + span, rowCount, firstChannel };
}

/** The first epoch and the first rows of `recording`; scale settings carry over. */
function freshView(
  view: View,
  recording: OpenRecording | undefined,
): Pick<State, "view" | "selection" | "cursorS"> {
  const next = { ...view, t0: 0, t1: view.epochS, firstChannel: 0, rowCount: DEFAULT_ROWS };
  return { view: clamp(next, recording), selection: null, cursorS: null };
}

/** What the selected tab keeps while another is shown; a detached tab keeps its view and takes its result along. */
export function tabViewOf(s: State, kept?: TabView): TabView {
  const recording = activeRecording(s);
  const { mmPerCssMm: _, ...view } = s.view;
  const result = { shownResult: s.shownResult, activeResultId: s.activeResultId };
  if (recording)
    return { view, selection: s.selection, selectedChannels: recording.selectedChannels, ...result };
  const first = { ...view, t0: 0, t1: view.epochS, firstChannel: 0, rowCount: DEFAULT_ROWS };
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
  const recordings =
    id !== null && recording && saved
      ? {
          ...all,
          [id]: { ...recording, selectedChannels: saved.selectedChannels.filter((c) => c < channels) },
        }
      : all;
  return shownAlone(s, {
    tabs,
    recordings,
    activeTab: fingerprint,
    activeRecordingId: id,
    view: saved ? clamp({ ...s.view, ...saved.view }, recording) : freshView(s.view, recording).view,
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
  recording: Omit<OpenRecording, "scan" | "selectedChannels">,
  activate = true,
) {
  const scan: ScanState = { scannedRows: 0, totalRows: recording.info.sample_count };
  const added: OpenRecording = { ...recording, scan, selectedChannels: [] };
  useStore.setState((s) => {
    const recordings = { ...s.recordings, [id]: added };
    return activate ? enter(s, added.fingerprint, { recordings }) : { recordings };
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

/** Adds (`on`) or removes display channels from the active recording's analysis choice. */
export function selectChannels(channels: number[], on: boolean) {
  useStore.setState((s) => {
    const recording = activeRecording(s);
    if (!recording || !s.activeRecordingId) return s;
    const chosen = new Set(recording.selectedChannels);
    for (const c of channels) {
      if (on) chosen.add(c);
      else chosen.delete(c);
    }
    const selectedChannels = [...chosen].sort((a, b) => a - b);
    return { recordings: { ...s.recordings, [s.activeRecordingId]: { ...recording, selectedChannels } } };
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

/** Physical millimetres per second across the plot. */
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

export const setShownResult = (change: Partial<ShownResult>) =>
  useStore.setState((s) => ({ shownResult: s.shownResult && { ...s.shownResult, ...change } }));

export const togglePanel = (panel: keyof State["panels"]) =>
  useStore.setState((s) => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } }));

export const setSelection = (selection: State["selection"]) => useStore.setState({ selection });
export const setCursor = (cursorS: number | null) => useStore.setState({ cursorS });
export const setPlotWidth = (plotCssWidth: number) => useStore.setState({ plotCssWidth });

export function setTheme(theme: Theme) {
  saveTheme(theme);
  useStore.setState({ theme });
}
