import { expect, test } from "vitest";
import { blockBudgetMb, runAnalysis } from "./scheduler";
import type { Block, BlockChunks, Plan } from "./types";

/** `n` blocks of 10 windows each. */
const planOf = (n: number): Plan => ({
  blocks: Array.from({ length: n }, (_, i) => ({ w0: 10 * i, w1: 10 * i + 10, row0: 0, row1: 0 })),
  layout: { arrays: [] },
  windows: 10 * n,
});

/** A dispatch whose blocks the test finishes, in any order. */
function fakeWorkers() {
  const inFlight = new Map<number, { resolve(c: BlockChunks): void; reject(e: Error): void }>();
  const dispatched: number[] = [];
  let peak = 0;
  return {
    dispatched,
    inFlight,
    peak: () => peak,
    dispatch: (block: Block) =>
      new Promise<BlockChunks>((resolve, reject) => {
        dispatched.push(block.w0);
        inFlight.set(block.w0, { resolve, reject });
        peak = Math.max(peak, inFlight.size);
      }),
    finish(w0: number) {
      inFlight.get(w0)?.resolve({ chunks: [{ array: 0, offset: w0, bytes: new ArrayBuffer(8) }] });
      inFlight.delete(w0);
    },
    fail(w0: number, error: Error) {
      inFlight.get(w0)?.reject(error);
      inFlight.delete(w0);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("dispatches_in_parallel_and_writes_in_any_order", async () => {
  const pool = fakeWorkers();
  const written: number[] = [];
  const run = runAnalysis({
    id: "r1",
    plan: planOf(6),
    workers: 3,
    dispatch: pool.dispatch,
    write: async ({ chunks }) => void written.push(chunks[0].offset),
  });
  const seen: number[] = [];
  run.progress((p) => seen.push(p.windowsDone));
  expect(pool.dispatched).toEqual([0, 10, 20]);
  pool.finish(20);
  pool.finish(0);
  await settle();
  expect(pool.dispatched).toEqual([0, 10, 20, 30, 40]);
  for (const w0 of [40, 10, 30, 50]) {
    pool.finish(w0);
    await settle();
  }
  await expect(run.done).resolves.toEqual({ resultId: "r1" });
  expect(written).toEqual([20, 0, 40, 10, 30, 50]);
  expect(pool.peak()).toBe(3);
  expect(seen).toEqual([10, 20, 30, 40, 50, 60]);
});

test("cancel_stops_dispatch_and_rejects_done", async () => {
  const pool = fakeWorkers();
  const written: number[] = [];
  const run = runAnalysis({
    id: "r2",
    plan: planOf(5),
    workers: 2,
    dispatch: pool.dispatch,
    write: async ({ chunks }) => void written.push(chunks[0].offset),
  });
  run.cancel();
  await expect(run.done).rejects.toMatchObject({ name: "AbortError" });
  pool.finish(0);
  pool.finish(10);
  await settle();
  expect(pool.dispatched).toEqual([0, 10]);
  expect(written).toEqual([]);
});

test("worker_error_fails_run_with_engine_message", async () => {
  const pool = fakeWorkers();
  const run = runAnalysis({
    id: "r3",
    plan: planOf(4),
    workers: 2,
    dispatch: pool.dispatch,
    write: async () => {},
  });
  pool.fail(10, new Error("channel 9 is out of range for 4 analysis channels"));
  await expect(run.done).rejects.toThrow("channel 9 is out of range for 4 analysis channels");
  pool.finish(0);
  await settle();
  expect(pool.dispatched).toEqual([0, 10]);
});

test("a_failed_write_fails_the_run", async () => {
  const pool = fakeWorkers();
  const run = runAnalysis({
    id: "r4",
    plan: planOf(2),
    workers: 1,
    dispatch: pool.dispatch,
    write: () => Promise.reject(new Error("The result needs about 2 GB of browser storage")),
  });
  pool.finish(0);
  await expect(run.done).rejects.toThrow("browser storage");
});

test("budget_lets_blocks_outnumber_workers", () => {
  // At 16 MiB a block holds 100 windows: 10,000 windows need about 1,600 MiB, 50 MiB a block for 16 workers.
  const plan16 = { blocks: [{ w0: 0, w1: 100, row0: 0, row1: 0 }], layout: { arrays: [] }, windows: 10_000 };
  expect(blockBudgetMb(plan16, 16)).toBe(16);
  expect(blockBudgetMb({ ...plan16, windows: 1_000 }, 4)).toBe(16);
  expect(blockBudgetMb({ ...plan16, windows: 1_000 }, 16)).toBe(5);
  // A whole MiB at least: the core takes whole MiB, and 0 would mean a block per window.
  expect(blockBudgetMb({ ...plan16, windows: 100 }, 17)).toBe(1);
});
