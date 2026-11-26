// Basic DDA flavors (ST, CT, DE, CD, SY) on WebGPU equal the CPU to < 1e-6 via the shared `gpu_sums.wgsl` shader,
// and the result records "webgpu". Skipped in a browser without a WebGPU adapter (most headless runs).
import { expect, test } from "./test";

test("gpu_sums_match_the_cpu", async ({ page }) => {
  await page.goto("/");
  const adapter = await page.evaluate(async () => (await navigator.gpu?.requestAdapter()) != null);
  test.skip(!adapter, "no WebGPU adapter");
  const outcome = await page.evaluate(async () => {
    const { engine } = window.__ddalab;
    const opened = await engine.open({
      kind: "synthetic",
      spec: { channels: 6, rateHz: 256, durationS: 120, seed: 11 },
    });
    const variants = ["ST", "CT", "DE", "CD", "SY"] as const;
    const request = {
      file_path: "",
      channels: [0, 1, 2, 3, 4, 5],
      time_range: { start: 0, end: opened.info.sample_count - 1 },
      preprocessing_options: { highpass: null, lowpass: null },
      algorithm_selection: { enabled_variants: [...variants] },
      window_parameters: { window_length: 200, window_step: 100 },
      delay_parameters: { delays: [7, 10] },
      ct_channel_pairs: [
        [0, 1],
        [2, 3],
      ] as [number, number][],
      cd_channel_pairs: [
        [0, 1],
        [1, 0],
      ] as [number, number][],
    };
    const run = async (gpu: boolean) => {
      const handle = await engine.run(opened.id, request, { gpu });
      await handle.done;
      const manifest = await engine.resultManifest(handle.id);
      const byVariant: Record<string, number[][]> = {};
      for (const variant of variants) {
        const csv = await (await engine.exportCsv(handle.id, variant)).text();
        byVariant[variant] = csv
          .trim()
          .split("\n")
          .slice(1)
          .map((line) => line.split(",").slice(1).map(Number));
      }
      return { device: manifest.reproduction.compute_device, byVariant };
    };
    return { cpu: await run(false), gpu: await run(true), variants };
  });
  expect([outcome.cpu.device, outcome.gpu.device]).toEqual(["cpu", "webgpu"]);
  for (const variant of outcome.variants) {
    const cpuRows = outcome.cpu.byVariant[variant];
    const gpuRows = outcome.gpu.byVariant[variant];
    expect(gpuRows, variant).toHaveLength(cpuRows.length);
    for (const [w, row] of cpuRows.entries()) {
      for (const [c, x] of row.entries()) {
        const y = gpuRows[w][c];
        expect(Number.isNaN(y), `${variant} window ${w} row ${c}`).toBe(Number.isNaN(x));
        if (Number.isFinite(x)) {
          expect(Math.abs(x - y), `${variant} window ${w} row ${c}`).toBeLessThan(
            1e-6 * Math.max(Math.abs(x), 1e-3),
          );
        }
      }
    }
  }
});
