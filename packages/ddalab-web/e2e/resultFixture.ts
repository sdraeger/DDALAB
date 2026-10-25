// A result written straight into OPFS for the active recording, and shown: what e2e/results.spec.ts and the memory
// contract in e2e/perf.spec.ts view without running DDA.
import type { Page } from "@playwright/test";

export interface Fixture {
  id: string;
  windows: number;
  rows: number;
  /** The center of window 0 and the step between centers, in seconds; windows are 256 samples long. */
  first: number;
  step: number;
  /** Values in place of the seeded ones (uniform in 0.2 to 0.6): window, row, value. */
  values: [number, number, number][];
  /** Row labels; the recording's first channels by default. */
  labels?: string[];
  /** Leave out `ST/q.npy` (the manifest still lists it). */
  noArray?: boolean;
}

/** Writes the fixture's files (the array in pieces of 16 MB) and shows it under the waveform. */
export const showFixture = (page: Page, fixture: Fixture) =>
  page.evaluate(async (f) => {
    const { store } = window.__ddalab;
    const recording = store.getState().recordings[store.getState().activeRecordingId as string];
    const labels =
      f.labels ?? recording.analysis_channels.slice(0, f.rows).map((c) => recording.info.channels[c].label);
    const results = await (await navigator.storage.getDirectory()).getDirectoryHandle("results", {
      create: true,
    });
    const directory = await results.getDirectoryHandle(f.id, { create: true });
    const write = async (
      folder: FileSystemDirectoryHandle,
      name: string,
      parts: () => AsyncIterable<BlobPart>,
    ) => {
      const file = await (await folder.getFileHandle(name, { create: true })).createWritable();
      for await (const part of parts()) await file.write(part);
      await file.close();
    };
    if (!f.noArray) {
      await write(await directory.getDirectoryHandle("ST", { create: true }), "q.npy", async function* () {
        // The 128-byte header dda-rs writes: magic, version 1.0, the dict's length (118) and the dict padded to it.
        const dict = `{'descr': '<f8', 'fortran_order': False, 'shape': (${f.windows}, ${f.rows}), }`;
        const header = new Uint8Array(128);
        header.set([0x93, 78, 85, 77, 80, 89, 1, 0, 118, 0]);
        header.set(new TextEncoder().encode(`${dict.padEnd(117)}\n`), 10);
        yield header;
        const piece = Math.max(1, Math.floor(2 ** 21 / f.rows));
        let seed = 11;
        for (let w0 = 0; w0 < f.windows; w0 += piece) {
          const n = Math.min(piece, f.windows - w0);
          const values = new Float64Array(n * f.rows);
          for (let i = 0; i < values.length; i++) {
            seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
            values[i] = 0.2 + (0.4 * seed) / 2 ** 31;
          }
          for (const [w, r, v] of f.values) if (w >= w0 && w < w0 + n) values[(w - w0) * f.rows + r] = v;
          yield values;
        }
      });
    }
    const manifest = {
      schema: "ddalab.result/2",
      id: f.id,
      file_name: "synthetic.edf",
      created_at_iso: new Date().toISOString(),
      diagnostics: [],
      window_centers_seconds: Array.from({ length: f.windows }, (_, i) => f.first + i * f.step),
      variants: [{ id: "ST", label: "Single Timeseries (ST)", row_labels: labels, arrays: ["ST/q.npy"] }],
      reproduction: { window_length_samples: 256, window_step_samples: 256 * f.step },
    };
    await write(directory, "manifest.json", async function* () {
      yield JSON.stringify(manifest);
    });
    await write(directory, "status", async function* () {
      yield "complete";
    });
    store.setState({
      shownResult: { id: f.id, fingerprint: recording.fingerprint, variant: null, array: "q", row: null },
    });
  }, fixture);
