// The e2e probe of the result views (`window.__ddalab.results`): the heatmap's frames and pixels and the row plot's
// points. Only dev and e2e builds fill it; production code never reads it.
import type { MapName } from "../../render/colormaps";
import type { ResultTile } from "../../render/resultPyramid";

export interface HeatmapProbeFrame {
  resultId: string;
  variant: string;
  array: ResultTile["array"];
  /** Device pixels of the heatmap canvas. */
  width: number;
  height: number;
  rows: number;
  level: number;
  map: MapName;
  lo: number;
  hi: number;
  /** Every slot drew from its own tile. */
  complete: boolean;
}

export const heatmapProbe = {
  frame: null as HeatmapProbeFrame | null,
  waiters: [] as ((frame: HeatmapProbeFrame) => void)[],
  /** The plotted row and its points: window-center times (cell centers zoomed out) and float32 values. */
  rowPlot: null as { row: number; points: { t: number; v: number }[] } | null,
  redraw: undefined as (() => void) | undefined,
  read: undefined as (() => { width: number; height: number; data: Uint8Array }) | undefined,
  /** Resolves with the next frame that drew every slot from its own tile. */
  settled(): Promise<HeatmapProbeFrame> {
    return new Promise((resolve) => {
      heatmapProbe.waiters.push(resolve);
      heatmapProbe.redraw?.();
    });
  },
  /** Draws now and reads the heatmap canvas back: RGBA, bottom row first. */
  pixels() {
    if (!heatmapProbe.read) throw new Error("no heatmap canvas");
    return heatmapProbe.read();
  },
};
