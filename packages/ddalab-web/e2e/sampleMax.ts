// The memory sampler of e2e/bench.spec.ts. It runs in the page, injected as its source: it may use globals only.

export interface Sampled {
  /** The largest value measured. */
  max: number;
  samples: number;
  /** Mean milliseconds between the starts of consecutive samples; NaN for one sample. */
  intervalMs: number;
}

/**
 * Measures from now until `until` settles: a sample starts every `intervalMs`, or as soon as the one before returns
 * when it took longer. At least one sample is taken.
 */
export async function sampleMax(
  measure: () => Promise<number>,
  until: Promise<unknown>,
  intervalMs: number,
): Promise<Sampled> {
  let settled = false;
  const over = until.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const starts: number[] = [];
  let max = Number.NEGATIVE_INFINITY;
  do {
    const start = performance.now();
    starts.push(start);
    max = Math.max(max, await measure());
    const wait = start + intervalMs - performance.now();
    if (wait > 0 && !settled) await Promise.race([over, new Promise((r) => setTimeout(r, wait))]);
  } while (!settled);
  const span = starts[starts.length - 1] - starts[0];
  return {
    max,
    samples: starts.length,
    intervalMs: starts.length > 1 ? span / (starts.length - 1) : Number.NaN,
  };
}
