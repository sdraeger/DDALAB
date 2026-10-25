// The e2e probe (`window.__ddalab.viewer`): what tests see of the waveform's frames. Only dev and e2e builds fill
// it; production code never reads it.
import type { DrawPlan } from "../../render/levels";
import type { Gap } from "../../render/waveformLayer";

export interface ProbeFrame {
  recordingId: string;
  /** Device pixels of the trace canvas, and its CSS width. */
  width: number;
  height: number;
  cssWidth: number;
  rowCount: number;
  mode: DrawPlan["mode"];
  level: number | null;
  /** Every slot drew from its planned data. */
  complete: boolean;
  gaps: Gap[];
  error: string | null;
}

export interface FrameRecord {
  /** The whole frame, from the start of paint to the GPU finishing it. */
  ms: number;
  complete: boolean;
  /** Device-pixel columns that drew no data. */
  blank: number;
}

export const probing = import.meta.env.DEV || import.meta.env.MODE === "e2e";

export const viewerProbe = {
  frame: null as ProbeFrame | null,
  waiters: [] as ((frame: ProbeFrame) => void)[],
  /** Every frame drawn while an array; `null` turns the record off. */
  frames: null as FrameRecord[] | null,
  redraw: undefined as (() => void) | undefined,
  read: undefined as (() => { width: number; height: number; data: Uint8Array }) | undefined,
  /** Resolves with the next frame of the active recording that has all its planned data. */
  settled(): Promise<ProbeFrame> {
    return new Promise((resolve) => {
      viewerProbe.waiters.push(resolve);
      viewerProbe.redraw?.();
    });
  },
  /** Draws now and reads the trace canvas back: RGBA, bottom row first. */
  pixels() {
    if (!viewerProbe.read) throw new Error("no waveform canvas");
    return viewerProbe.read();
  },
};
