// When a layer asks again for data it could not get (waveform and heatmap tiles, raw rows): an engine that restarted
// is asked again at once and says nothing the first time; any other failure waits a pause that doubles from 0.5 s up to
// 30 s and shows its reason.
import { EngineStopped } from "../core/engine";

export interface Failure {
  retryAt: number;
  attempts: number;
  /** What the user sees; `null` while the engine restarts. */
  reason: string | null;
  /** Milliseconds until `retryAt`. */
  pause: number;
}

/** The failure after `previous` (or the first) when a request failed with `error`. */
export function nextFailure(previous: Failure | undefined, error: unknown): Failure {
  const attempts = (previous?.attempts ?? 0) + 1;
  const quiet = error instanceof EngineStopped && attempts === 1;
  const pause = quiet ? 0 : Math.min(30_000, 500 * 2 ** (attempts - 1));
  const reason = quiet ? null : error instanceof Error ? error.message : String(error);
  return { retryAt: performance.now() + pause, attempts, reason, pause };
}
