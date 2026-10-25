// The one store. Sample, tile and result arrays never enter it; they live in workers.
import { create } from "zustand";
import type { ScanState } from "../core/protocol";
import type { Annotation, RecordingInfo } from "../core/types";
import type { RecentEntry } from "./recent";

export interface OpenRecording {
  info: RecordingInfo;
  fingerprint: string;
  scan: ScanState;
  source: "files" | "url" | "synthetic";
}

interface State {
  recordings: Record<string, OpenRecording>;
  activeRecordingId: string | null;
  recent: RecentEntry[];
}

export const useStore = create<State>()(() => ({ recordings: {}, activeRecordingId: null, recent: [] }));

/** Adds a freshly opened recording, which nothing has scanned yet, and makes it the active one. */
export function addRecording(id: string, recording: Omit<OpenRecording, "scan">) {
  const scan: ScanState = { scannedRows: 0, totalRows: recording.info.sample_count };
  useStore.setState((s) => ({
    recordings: { ...s.recordings, [id]: { ...recording, scan } },
    activeRecordingId: id,
  }));
}

/** Drops a recording; the most recently added of the rest becomes the active one. */
export function removeRecording(id: string) {
  useStore.setState((s) => {
    const { [id]: _, ...recordings } = s.recordings;
    const active =
      s.activeRecordingId === id ? (Object.keys(recordings).at(-1) ?? null) : s.activeRecordingId;
    return { recordings, activeRecordingId: active };
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
