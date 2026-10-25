// The background scan of a recording: one pass over every row that builds all levels of the pyramid and stores their
// tiles in OPFS. The pass runs in slices inside the IO worker, which answers other requests between them.
import type { Core } from "../core/abi";
import { hasStorage, pyramidBytes, QuotaError, readJson, saveTiles, tileSlot, writeJson } from "../core/opfs";
import type { ScanState } from "../core/protocol";
import type { RawType } from "../core/types";

/** File bytes read per slice. */
const SLICE_BYTES = 16 * 2 ** 20;
/** Progress is reported at most this often, in ms. */
const REPORT_MS = 100;

/** Lets the worker handle the messages that arrived meanwhile. */
export const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve));

export interface ScanJob {
  core: Core;
  handle: number;
  fingerprint: string;
  rows: number;
  /** Display channels, which the tiles hold. */
  channels: number;
  rawType: RawType;
  /** Bytes of the files the rows come from, for sizing slices. */
  fileBytes: number;
  emit(state: ScanState): void;
  closed(): boolean;
}

const quotaExceeded = (error: unknown) =>
  error instanceof DOMException && error.name === "QuotaExceededError";

/**
 * Pushes the rows through the core's pyramid in order from row 0, which is the only order it takes (the tiles of
 * the visible region are built on demand, see `tile` in io.worker.ts) and stores each tile as it completes. The
 * `scan.json` record, written last, tells a later session that every tile is there.
 */
export async function scan(job: ScanJob): Promise<void> {
  const { core, handle, fingerprint, rows, channels, rawType, fileBytes, emit, closed } = job;
  let scannedRows = 0;
  await yieldToLoop(); // the reply to `open` goes first
  try {
    if (!(await hasStorage())) {
      return emit({
        scannedRows: 0,
        totalRows: rows,
        notice:
          "Browser storage is not available in this window, which private browsing can cause; no overview is stored.",
      });
    }
    const layout = { rows, channels, rawType };
    if (JSON.stringify(await readJson(fingerprint, "scan.json")) === JSON.stringify(layout)) {
      return emit({ scannedRows: rows, totalRows: rows });
    }
    const slot = tileSlot(channels, rawType);
    const perSlice = Math.max(1, Math.floor((SLICE_BYTES * rows) / fileBytes));
    const pyramid = core.pyramid(handle);
    try {
      let reported = 0;
      for (let row = 0; row < rows; row += perSlice) {
        const n = Math.min(perSlice, rows - row);
        await saveTiles(fingerprint, slot, pyramid.push(row, n));
        scannedRows = row + n;
        if (Date.now() - reported > REPORT_MS) {
          reported = Date.now();
          emit({ scannedRows, totalRows: rows });
        }
        await yieldToLoop();
        if (closed()) return;
      }
      await saveTiles(fingerprint, slot, pyramid.finish());
      await writeJson(fingerprint, "scan.json", layout);
    } catch (error) {
      pyramid.drop();
      throw error;
    }
    emit({ scannedRows: rows, totalRows: rows });
  } catch (error) {
    const reason = quotaExceeded(error)
      ? new QuotaError(pyramidBytes(rows, channels, rawType))
      : error instanceof Error
        ? error
        : new Error(String(error));
    emit({ scannedRows, totalRows: rows, error: reason.message });
    // A trapped instance is unusable: the worker must know.
    if (error instanceof WebAssembly.RuntimeError) throw error;
  }
}
