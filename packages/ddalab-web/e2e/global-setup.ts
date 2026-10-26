// Before the tests: the native CLI's bundles for the requests e2e/analysis.spec.ts runs in the browser, in a
// directory of this run that the teardown deletes. The CLI is built from packages/dda-rs first (a no-op when it is up
// to date).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSynthetic, syntheticEdfSize } from "../src/core/synthetic";

const DDA_RS = fileURLToPath(new URL("../../dda-rs", import.meta.url));
export const CLI = join(DDA_RS, "target/release/ddalab");
const VHDR = join(DDA_RS, "tests/fixtures/fixture.vhdr");

/** 64 channels: all of them over 0 to 30 s plan five blocks at the browser's 1 MiB floor with eight workers. */
export const WIDE = { channels: 64, rateHz: 256, durationS: 40, seed: 7 };

const COMMON = ["--wl", "200", "--ws", "100", "--delays", "7", "10", "--model", "1", "2", "10"];
/** 1 s to 5 s at 500 Hz. */
const BRAINVISION_RANGE = ["--start-sample", "500", "--end-sample", "2500"];

/** The CLI bundles: one per request. */
export type Bundle = "st" | "ct_cd_de_sy" | "multi_block";

/** The directory of the CLI bundle `name`. */
export function bundleDir(name: Bundle) {
  const root = process.env.DDALAB_E2E_BUNDLES;
  if (!root) throw new Error("e2e/global-setup.ts has not run");
  return join(root, name);
}

export default function globalSetup() {
  execFileSync("cargo", ["build", "--release"], { cwd: DDA_RS, stdio: "inherit" });
  const root = mkdtempSync(join(tmpdir(), "ddalab-e2e-"));
  process.env.DDALAB_E2E_BUNDLES = root; // the test workers inherit it
  const wide = join(root, "wide.edf");
  const bytes = new Uint8Array(syntheticEdfSize(WIDE));
  readSynthetic(WIDE, 0, bytes);
  writeFileSync(wide, bytes);
  const allWide = Array.from({ length: WIDE.channels }, (_, c) => String(c));
  // The file and arguments of each run; the browser runs the same requests through the UI.
  const cases = {
    // Channels Fp1 and Fp2.
    st: [VHDR, "--channels", "0", "1", "--variants", "ST", ...BRAINVISION_RANGE],
    // Two channels: the one CT pair and both CD directions.
    ct_cd_de_sy: [
      VHDR,
      ...["--channels", "0", "1", "--variants", "CT", "CD", "DE", "SY"],
      ...["--ct-pairs", "0,1", "--cd-pairs", "0,1", "1,0"],
      ...BRAINVISION_RANGE,
    ],
    multi_block: [
      wide,
      "--channels",
      ...allWide,
      "--variants",
      "ST",
      "--start-sample",
      "0",
      "--end-sample",
      "7680",
    ],
  };
  for (const [name, [file, ...args]] of Object.entries(cases)) {
    execFileSync(CLI, ["run", "--file", file, ...args, ...COMMON, "--bundle", join(root, name), "--quiet"]);
  }
  return () => rmSync(root, { recursive: true, force: true });
}
