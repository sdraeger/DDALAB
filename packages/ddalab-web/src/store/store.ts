// The one store. Sample, tile and result arrays never enter it; they live in workers.
import { create } from "zustand";
import type { ScanState } from "../core/protocol";
import type { RecordingInfo } from "../core/types";
import type { RecentEntry } from "./recent";

export interface OpenRecording {
  info: RecordingInfo;
  fingerprint: string;
  scan: ScanState;
  source: "files" | "url";
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
