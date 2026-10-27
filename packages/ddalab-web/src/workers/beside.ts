// Which requests the IO worker answers beside its queue (io.worker.ts).
import type { IoRequest } from "../core/protocol";

/**
 * Requests that use no engine and can take seconds (a large result, a lock another tab holds): tiles and rows go on
 * while they run. The startup sweep runs here too, without waiting for the wasm compile; a result being written holds
 * its lock from before its directory exists (createResultFiles), which the sweep skips. So do manifest reads, which a
 * pointer over the history makes and which must not hold back the waveform's reads, and a result's arrays and tiles:
 * the first read of an array builds its pyramid, once (resultStore.ts), under its own locks.
 */
export const BESIDE = new Set<IoRequest["type"]>([
  "exportDocument",
  "exportCsv",
  "importResult",
  "importResults",
  "deleteResult",
  "sweepResults",
  "resultManifest",
  "resultArray",
  "resultTile",
]);
