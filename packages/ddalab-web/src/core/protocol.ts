// The messages between engine.ts (main thread) and the IO worker. Every request carries a serial `n` the reply echoes.
import type { RecordingInput } from "./engine";
import type { Annotation, EngineVersion, RecordingInfo } from "./types";

/** How far the background scan of a recording has come. */
export interface ScanState {
  scannedRows: number;
  totalRows: number;
  /** Hex SHA-256 by input file name, filled in as each file finishes. */
  sha256?: Record<string, string>;
  /** Why no overview is built, when that is by design. */
  notice?: string;
  error?: string;
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
  | { type: "annotations"; id: string }
  // Dev and e2e builds only:
  | { type: "trap" } // raises the error a Rust panic raises
  | { type: "quota"; bytes: number }; // the storage fills up after this many more bytes of writes

export interface IoResults {
  version: EngineVersion;
  open: { info: RecordingInfo; fingerprint: string };
  close: undefined;
  raw: Float32Array;
  /** `null` while the scan has not reached the tile and reading it from the file would take too long. */
  tile: Tile | null;
  annotations: { annotations: Annotation[]; warnings: string[] };
  trap: undefined;
  quota: undefined;
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
  | { type: "hash"; id: string; fingerprint: string; input: RecordingInput; names: string[] }
  | { type: "cancel"; id: string };

export type HashReply = { id: string; name: string; sha256: string } | { id: string; error: string };
