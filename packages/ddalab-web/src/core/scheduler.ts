// The run of a plan: blocks go to free workers, each block's arrays are written as soon as it is done (in any
// order: every chunk carries its file offset), and the run fails with the first error. Pure: the workers and the
// storage come in as functions.
import type { Block, BlockChunks, Plan } from "./types";

export interface RunProgress {
  blocksDone: number;
  blocks: number;
  windowsDone: number;
  windows: number;
  /** Seconds left at the rate so far; `null` before the first block is done. */
  etaS: number | null;
}

export interface AnalysisHandle {
  id: string;
  /** Calls `listener` after every block that is written. */
  progress(listener: (p: RunProgress) => void): () => void;
  /** Rejects with the first error, or with an `AbortError` after `cancel`. */
  done: Promise<{ resultId: string }>;
  /** No block starts after this; blocks in flight are dropped (their workers are the caller's to stop). */
  cancel(): void;
}

/** The core's largest block budget in the browser, in MiB. */
export const MAX_BLOCK_MB = 16;

/**
 * MiB per block, `min(16, needed / (2 x workers))`, so that blocks outnumber workers. `needed` is estimated from the
 * plan at 16 MiB (its first block's windows fill 16 MiB). At least 1: the core takes whole MiB, and 0 would make every
 * window a block of its own.
 */
export function blockBudgetMb(plan16: Plan, workers: number): number {
  const first = plan16.blocks[0];
  const neededMb = first ? (plan16.windows / (first.w1 - first.w0)) * MAX_BLOCK_MB : 0;
  return Math.max(1, Math.min(MAX_BLOCK_MB, Math.floor(neededMb / (2 * workers))));
}

export function runAnalysis(deps: {
  id: string;
  plan: Plan;
  dispatch: (block: Block) => Promise<BlockChunks>;
  write: (chunks: BlockChunks) => Promise<void>;
  workers: number;
}): AnalysisHandle {
  const { id, plan, dispatch, write } = deps;
  const listeners = new Set<(p: RunProgress) => void>();
  const started = performance.now();
  let next = 0;
  let blocksDone = 0;
  let windowsDone = 0;
  let stopped = false;
  let settle: { resolve(value: { resultId: string }): void; reject(error: Error): void } | undefined;
  const done = new Promise<{ resultId: string }>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const finish = (error?: Error) => {
    if (stopped) return;
    stopped = true;
    if (error) settle?.reject(error);
    else settle?.resolve({ resultId: id });
  };

  /** Gives the next block to the worker that just became free. */
  const take = () => {
    if (stopped || next === plan.blocks.length) return;
    const block = plan.blocks[next++];
    dispatch(block)
      .then((chunks) => {
        if (stopped) return;
        take();
        return write(chunks).then(() => {
          if (stopped) return;
          blocksDone++;
          windowsDone += block.w1 - block.w0;
          const elapsedS = (performance.now() - started) / 1000;
          const etaS = (elapsedS / windowsDone) * (plan.windows - windowsDone);
          const progress = {
            blocksDone,
            blocks: plan.blocks.length,
            windowsDone,
            windows: plan.windows,
            etaS,
          };
          for (const listener of listeners) listener(progress);
          if (blocksDone === plan.blocks.length) finish();
        });
      })
      .catch((error: Error) => finish(error));
  };
  if (plan.blocks.length === 0) finish();
  for (let w = 0; w < deps.workers; w++) take();

  return {
    id,
    progress(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    done,
    cancel: () => finish(new DOMException("The run was cancelled", "AbortError")),
  };
}
