// The messages between engine.ts (main thread) and the IO worker. Every request carries a serial `n` the reply echoes.
import type { ResultTile } from "../render/resultPyramid";
import type { RecordingInput } from "./engine";
import type { FolderFile } from "./imports";
import type {
  Annotation,
  Block,
  BlockChunks,
  BundleLayout,
  DDARequest,
  EngineVersion,
  ManifestExtras,
  Plan,
  RecordingInfo,
  ResultDocument,
} from "./types";

/** How far the background scan of a recording has come. */
export interface ScanState {
  scannedRows: number;
  totalRows: number;
  /** Hex SHA-256 by input file name, filled in as each file finishes. */
  sha256?: Record<string, string>;
  /** The fraction of each input file hashed so far, by name. */
  hashed?: Record<string, number>;
  /** Why no overview is built, when that is by design. */
  notice?: string;
  error?: string;
  /** Why the SHA-256 could not be computed; `error` shows it only when the scan has none of its own. */
  hashError?: string;
}

/** One array of a complete result: its size, its pyramid's levels and the finite range of each row. */
export interface ResultArray {
  windows: number;
  rows: number;
  levels: number;
  rowMin: Float64Array;
  rowMax: Float64Array;
}

/** An encoded extrema tile (`DDT1`, see dda-rs `tiles.rs`) of the pyramid. */
export interface Tile {
  level: number;
  index: number;
  bytes: ArrayBuffer;
}

export type IoRequest =
  | { type: "version" }
  | { type: "open"; id: string; input: RecordingInput }
  | { type: "close"; id: string }
  | { type: "raw"; id: string; row0: number; rows: number }
  | { type: "tile"; id: string; level: number; index: number }
  /** The blocks of a run of `request` on `workers` workers (see `blockBudgetMb`). */
  | { type: "plan"; id: string; request: DDARequest; workers: number }
  // The result files of a run (resultStore.ts).
  | { type: "createResult"; resultId: string; layout: BundleLayout }
  | { type: "writeChunks"; resultId: string; chunks: BlockChunks }
  | { type: "finishResult"; resultId: string; manifest: ResultDocument }
  | { type: "discardResult"; resultId: string }
  | { type: "sweepResults" }
  // Complete results: the heatmap reads them, the history deletes them.
  | { type: "resultManifest"; resultId: string }
  | { type: "resultArray"; resultId: string; variant: string; array: ResultTile["array"] }
  | {
      type: "resultTile";
      resultId: string;
      variant: string;
      array: ResultTile["array"];
      level: number;
      index: number;
    }
  | { type: "deleteResult"; resultId: string }
  // Exports and imports of results (exporters.ts, imports.ts); they run beside the other requests.
  | { type: "exportDocument"; resultId: string }
  | { type: "exportCsv"; resultId: string; variant: string }
  | { type: "importResult"; input: File | FolderFile[] }
  // Dev and e2e builds only:
  | { type: "trap" } // raises the error a Rust panic raises
  | { type: "quota"; bytes: number } // the storage fills up after this many more bytes of writes
  | { type: "memory" }; // bytes of the worker's wasm memory

export interface IoResults {
  version: EngineVersion;
  open: {
    info: RecordingInfo;
    fingerprint: string;
    /** Indices into `info.channels` of the display channels (the core's `analysis_channels`). */
    analysis_channels: number[];
    /** The id of the open recording with this fingerprint, when there is one: this open was dropped. */
    duplicateOf?: string;
  };
  close: undefined;
  raw: Float32Array;
  /** `null` while the scan has not reached the tile and reading it from the file would take too long. */
  tile: Tile | null;
  plan: Plan;
  createResult: undefined;
  writeChunks: undefined;
  finishResult: undefined;
  discardResult: undefined;
  /** The ids of the results whose files were deleted. */
  sweepResults: string[];
  resultManifest: ResultDocument;
  /** The first request for an array builds its pyramid. */
  resultArray: ResultArray;
  resultTile: ResultTile;
  deleteResult: undefined;
  exportDocument: Blob;
  exportCsv: Blob;
  /** The id of the imported result. */
  importResult: string;
  trap: undefined;
  quota: undefined;
  memory: number;
}

/** Dev and e2e builds: asks the hash or annotation worker for the bytes of its wasm memory. */
export interface MemoryRequest {
  type: "memory";
}
export interface MemoryReply {
  wasmBytes: number;
}

export type IoReply =
  | { n: number; ok: unknown }
  /** `trapped`: the wasm instance trapped and is unusable; the engine replaces the worker. */
  | { n: number; error: string; trapped: boolean };

/** Sent by the worker without a request. */
export interface IoEvent {
  event: "scan";
  id: string;
  state: ScanState;
}

/** Asks the hash worker for the SHA-256 of `names`, files of `input`, which it reports one file at a time. */
export type HashRequest =
  | { type: "hash"; id: string; input: RecordingInput; names: string[] }
  | { type: "cancel"; id: string }
  | MemoryRequest;

/** A file's digest, an error, or how many of a file's `bytes` are hashed so far (at each whole percent). */
export type HashReply =
  | { id: string; name: string; sha256: string }
  | { id: string; error: string }
  | { id: string; name: string; hashedBytes: number; bytes: number };

/** Asks the annotation worker, which opens `input` itself, for the full annotation list. */
export interface AnnotationsRequest {
  n: number;
  input: RecordingInput;
}

export type Annotations = { annotations: Annotation[]; warnings: string[] };

/** Asks a DDA worker, which opens `input` itself, for a block of a run or, with `extras`, for its manifest. */
export type DdaRequest =
  | { input: RecordingInput; request: DDARequest; block: Block }
  | { input: RecordingInput; request: DDARequest; extras: ManifestExtras };

/** A DDA worker has one request at a time. `trapped`: the wasm instance trapped and is unusable. */
export type DdaReply = { ok: BlockChunks | ResultDocument } | { error: string; trapped: boolean };

export type AnnotationsReply =
  | { n: number; ok: Annotations }
  /** `trapped`: the wasm instance trapped and is unusable; the engine replaces the worker. */
  | { n: number; error: string; trapped: boolean };
