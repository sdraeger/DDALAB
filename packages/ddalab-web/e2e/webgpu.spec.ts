// ST on the GPU equals ST on the CPU to the agreement the settings state, and the result records the GPU. Skipped in
// a browser without a WebGPU adapter (most headless runs).
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
    const request = {
      file_path: "",
      channels: [0, 1, 2, 3, 4, 5],
      time_range: { start: 0, end: opened.info.sample_count - 1 },
      preprocessing_options: { highpass: null, lowpass: null },
      algorithm_selection: { enabled_variants: ["ST"] },
      window_parameters: { window_length: 200, window_step: 100 },
      delay_parameters: { delays: [7, 10] },
    };
    const run = async (gpu: boolean) => {
      const handle = await engine.run(opened.id, request, { gpu });
      await handle.done;
      const manifest = await engine.resultManifest(handle.id);
      const csv = await (await engine.exportCsv(handle.id, "ST")).text();
      const rows = csv
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.split(",").slice(1).map(Number));
      return { device: manifest.reproduction.compute_device, rows };
    };
    return { cpu: await run(false), gpu: await run(true) };
  });
  expect([outcome.cpu.device, outcome.gpu.device]).toEqual(["cpu", "webgpu-f32"]);
  const { cpu, gpu } = outcome;
  expect(gpu.rows).toHaveLength(cpu.rows.length);
  for (const [w, row] of cpu.rows.entries()) {
    for (const [c, x] of row.entries()) {
      const y = gpu.rows[w][c];
      expect(Number.isNaN(y), `window ${w} channel ${c}`).toBe(Number.isNaN(x));
      if (Number.isFinite(x)) {
        expect(Math.abs(x - y), `window ${w} channel ${c}`).toBeLessThan(1e-3 * Math.max(Math.abs(x), 1e-3));
      }
    }
  }
});
