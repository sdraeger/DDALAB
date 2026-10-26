// The CLI command of a result: run natively, it writes the bundle the browser's run of the same request writes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { instantiateCore } from "./abi";
import { cliCommand } from "./cliCommand";
import type { DDARequest } from "./types";

const FIXTURES = fileURLToPath(new URL("../../../dda-rs/tests/fixtures/", import.meta.url));
const CLI_DIR = fileURLToPath(new URL("../../../dda-rs/target/release/", import.meta.url));
/** Skipped without the native binary, except in CI, which builds it first and must not skip. */
const noCli = !existsSync(join(CLI_DIR, "ddalab")) && !process.env.CI;

/**
 * The BrainVision fixture with its header renamed to start with "-", which the CLI must read as a file name. The
 * header names its data and marker files itself.
 */
const PRIMARY = "-fixture.vhdr";
const BRAINVISION: [name: string, fixture: string][] = [
  [PRIMARY, "fixture.vhdr"],
  ["fixture.eeg", "fixture.eeg"],
  ["fixture.vmrk", "fixture.vmrk"],
];

/** Every v1 variant on Fp1 and Fp2 from sample 500 to 2500, with the pairs the browser makes of two channels. */
const request: DDARequest = {
  file_path: PRIMARY,
  channels: [0, 1],
  time_range: { start: 500, end: 2500 },
  preprocessing_options: { highpass: null, lowpass: null },
  algorithm_selection: { enabled_variants: ["ST", "CT", "CD", "DE", "SY"], select_mask: "1 1 1 0 1 1" },
  window_parameters: { window_length: 200, window_step: 100 },
  delay_parameters: { delays: [7, 10] },
  ct_channel_pairs: [[0, 1]],
  cd_channel_pairs: [
    [0, 1],
    [1, 0],
  ],
  model_parameters: { dm: 4, order: 4, nr_tau: 2 },
  model_terms: [1, 2, 10],
};

/** The bundle the browser writes for `request`: each array's bytes by path, and the manifest. */
async function browserBundle() {
  const files = BRAINVISION.map(([, fixture]) => readFileSync(join(FIXTURES, fixture)));
  const wasm = new WebAssembly.Module(readFileSync(new URL("./ddalab.wasm", import.meta.url)));
  const core = await instantiateCore(wasm, (fileId, offset, dst) =>
    dst.set(files[fileId - 1].subarray(offset, offset + dst.length)),
  );
  const { handle, info } = core.open({
    primary: PRIMARY,
    files: BRAINVISION.map(([name], i) => ({ name, file_id: i + 1, len: files[i].length })),
  });
  // One window per block: the most block seams.
  const plan = core.plan(handle, request, 0);
  const arrays = plan.layout.arrays.map(({ header, shape }) => {
    const bytes = new Uint8Array(header.length + 8 * shape.reduce((n, d) => n * d, 1));
    bytes.set(header);
    return bytes;
  });
  for (const block of plan.blocks) {
    for (const { array, offset, bytes } of core.runBlock(handle, request, block).chunks) {
      arrays[array].set(new Uint8Array(bytes), offset);
    }
  }
  const sha256 = (name: string) =>
    createHash("sha256")
      .update(files[BRAINVISION.findIndex(([n]) => n === name)])
      .digest("hex");
  const input_sha256 = Object.fromEntries(info.input_files.map((name) => [name, sha256(name)]));
  const extras = {
    id: "browser",
    created_at_iso: "2026-10-25T00:00:00Z",
    input_sha256,
    windows: plan.windows,
  };
  const manifest = core.manifest(handle, request, extras);
  return { arrays: plan.layout.arrays.map(({ path }, i) => [path, arrays[i]] as const), manifest };
}

test.skipIf(noCli)("round_trips_through_cli", async () => {
  const command = cliCommand(request, PRIMARY);
  expect(command).toBe(
    "ddalab run --file=-fixture.vhdr --channels 0 1 --variants ST CT CD DE SY --ct-pairs 0,1 --cd-pairs 0,1 1,0 " +
      "--wl 200 --ws 100 --delays 7 10 --model 1 2 10 --dm 4 --order 4 --nr-tau 2 " +
      "--start-sample 500 --end-sample 2500 --bundle=-fixture.dda",
  );
  const dir = mkdtempSync(join(tmpdir(), "ddalab-cli-"));
  for (const [name, fixture] of BRAINVISION) copyFileSync(join(FIXTURES, fixture), join(dir, name));
  execFileSync("sh", ["-c", command], {
    cwd: dir,
    env: { ...process.env, PATH: `${CLI_DIR}:${process.env.PATH}` },
    stdio: "pipe",
  });

  const bundle = join(dir, "-fixture.dda");
  const browser = await browserBundle();
  for (const [path, bytes] of browser.arrays) {
    expect(new Uint8Array(readFileSync(join(bundle, path))), path).toEqual(bytes);
  }
  const cli = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8"));
  // The id and the time are the run's own; this CLI build carries no DDALAB_GIT_COMMIT, the wasm build does.
  const own = { id: "", created_at_iso: "" };
  const commit = (manifest: typeof cli) => ({ ...manifest.reproduction, git_commit: null });
  expect({ ...cli, ...own, reproduction: commit(cli) }).toEqual({
    ...browser.manifest,
    ...own,
    reproduction: commit(browser.manifest),
  });
});

test("quotes_names_with_spaces", () => {
  const command = cliCommand({ ...request, file_path: "it's a recording.edf" }, "it's a recording.edf");
  expect(command).toContain(`--file='it'\\''s a recording.edf'`);
  expect(command).toContain(`--bundle='it'\\''s a recording.dda'`);
  // The shell reads each quoted name back as part of one word.
  const words = execFileSync("sh", ["-c", command.replace(/^ddalab run/, "printf '%s\\n'")], {
    encoding: "utf8",
  }).split("\n");
  expect(words[0]).toBe("--file=it's a recording.edf");
  expect(words.at(-2)).toBe("--bundle=it's a recording.dda");
});
