/** A `DDARequest` as `ddalab run` builds it (see the README for an example). */
export type DDARequest = Record<string, unknown>;

export interface Opened {
  handle: number;
  /** Format, channels, sample rate and count, annotations and warnings. */
  info: Record<string, unknown> & { sample_rate_hz: number; sample_count: number };
  analysis_channels: number[];
}

export interface Run {
  /** The manifest `ddalab run --bundle` writes. */
  manifest: Record<string, unknown> & { variants: { id: string }[]; window_centers_seconds: number[] };
  /** Each bundle array by its path, with its .npy shape. */
  arrays: Record<string, { shape: number[]; data: Float64Array }>;
}

export interface Engine {
  version(): { engine_version: string; variants: { abbreviation: string }[] } & Record<string, unknown>;
  /** Opens the recording whose files are `paths`, the primary first (a .vhdr with its .eeg and .vmrk, for example). */
  open(paths: string[], sampleRateHz?: number, cacheMb?: number): Opened;
  close(handle: number): void;
  annotations(handle: number): unknown;
  readRaw(handle: number, row0: number, rows: number): Float32Array;
  plan(handle: number, request: DDARequest, budgetMb: number): { blocks: { w0: number; w1: number }[]; windows: number } & Record<string, unknown>;
  /** Runs `request` on `handle` in blocks of at most `budgetMb` MiB of samples (default 64; 0 runs one window per block). */
  run(
    handle: number,
    request: DDARequest,
    options?: { budgetMb?: number; id?: string; createdAt?: string; inputSha256?: Record<string, string> },
  ): Run;
  sha256File(path: string): string;
}

/** Loads the engine; `onProgress` gets each progress object a run reports. */
export function load(options?: { onProgress?: (progress: unknown) => void }): Promise<Engine>;
/** The path of the packaged .wasm module. */
export const WASM: string;
export function decodeReply(reply: bigint): [number, number];
export function unframe(bytes: Uint8Array): Uint8Array[];
