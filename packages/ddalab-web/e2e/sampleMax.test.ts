import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sampleMax } from "./sampleMax";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "performance"] }));
afterEach(() => vi.useRealTimers());

/** A promise that resolves after `ms` of fake time. */
const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("samples_every_interval_until_the_promise_settles", async () => {
  let value = 0;
  const sampled = sampleMax(async () => ++value, after(1000), 250);
  await vi.advanceTimersByTimeAsync(1000);
  // Samples start at 0, 250, 500 and 750 ms; the run ends at 1000 during the wait.
  expect(await sampled).toEqual({ max: 4, samples: 4, intervalMs: 250 });
});

test("a_slow_measure_sets_the_interval", async () => {
  const values = [3, 9, 2];
  let i = 0;
  const measure = async () => {
    await after(600);
    return values[i++];
  };
  const sampled = sampleMax(measure, after(1500), 250);
  await vi.advanceTimersByTimeAsync(2000);
  // Each sample takes 600 ms: they start at 0, 600 and 1200, and the last returns after the run ended.
  expect(await sampled).toEqual({ max: 9, samples: 3, intervalMs: 600 });
});

test("one_sample_when_the_run_is_over_already", async () => {
  const sampled = await sampleMax(async () => 7, Promise.resolve(), 250);
  expect(sampled).toEqual({ max: 7, samples: 1, intervalMs: Number.NaN });
});

test("a_failed_run_ends_the_sampling", async () => {
  const failed = after(300).then(() => {
    throw new Error("cancelled");
  });
  failed.catch(() => {});
  const sampled = sampleMax(async () => 1, failed, 250);
  await vi.advanceTimersByTimeAsync(300);
  expect(await sampled).toMatchObject({ max: 1, samples: 2 });
});
