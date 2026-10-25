// Before the tests: the native CLI's bundles for the requests e2e/analysis.spec.ts runs in the browser. The binary
// is built from packages/dda-rs unless one is there already.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DDA_RS = fileURLToPath(new URL("../../dda-rs", import.meta.url));
const CLI = join(DDA_RS, "target/release/ddalab");
const VHDR = join(DDA_RS, "tests/fixtures/fixture.vhdr");

/** The arguments of each CLI run; the browser runs the same requests through the UI. */
export const CASES = {
  // Channels Fp1 and Fp2 from 1 s to 5 s at 500 Hz.
  st: ["--channels", "0", "1", "--variants", "ST"],
  // Two channels: the one CT pair and both CD directions.
  ct_cd_de_sy: [
    "--channels",
    "0",
    "1",
    "--variants",
    "CT",
    "CD",
    "DE",
    "SY",
    "--ct-pairs",
    "0,1",
    "--cd-pairs",
    "0,1",
    "1,0",
  ],
} satisfies Record<string, string[]>;

const COMMON = ["--wl", "200", "--ws", "100", "--delays", "7", "10", "--model", "1", "2", "10"];
const RANGE = ["--start-sample", "500", "--end-sample", "2500"];

export const bundleDir = (name: keyof typeof CASES) => join(tmpdir(), "ddalab-e2e-bundles", name);

export default function globalSetup() {
  if (!existsSync(CLI)) execFileSync("cargo", ["build", "--release"], { cwd: DDA_RS, stdio: "inherit" });
  for (const [name, args] of Object.entries(CASES)) {
    const dir = bundleDir(name as keyof typeof CASES);
    rmSync(dir, { recursive: true, force: true });
    execFileSync(CLI, ["run", "--file", VHDR, ...args, ...COMMON, ...RANGE, "--bundle", dir, "--quiet"]);
  }
}
