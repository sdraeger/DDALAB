// The messages between engine.ts (main thread) and the IO worker. Every request carries a serial `n` the reply echoes.
import type { RecordingInput } from "./engine";
import type { EngineVersion, RecordingInfo } from "./types";

/** How far the background scan of a recording has come. */
export interface ScanState {
  scannedRows: number;
  totalRows: number;
  sha256?: string;
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
  | { type: "trap" }; // dev and e2e builds only: raises the error a Rust panic raises

export interface IoResults {
  version: EngineVersion;
  open: { info: RecordingInfo; fingerprint: string };
  close: undefined;
  raw: Float32Array;
  trap: undefined;
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
