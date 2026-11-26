// Builds the engine's wasm ABI (with simd128 via root .cargo/config.toml), optionally runs wasm-opt
// when available on PATH, and copies the artifact to src/core/ddalab.wasm (gitignored).
// The build records `git rev-parse HEAD` as version().git_commit; without git the field stays null.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const root = here("../../..");

let commit;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  commit = undefined;
}

execFileSync(
  "cargo",
  ["build", "--profile", "wasm-release", "--target", "wasm32-unknown-unknown", "-p", "ddalab-wasm"],
  {
    cwd: root,
    env: commit ? { ...process.env, DDALAB_GIT_COMMIT: commit } : process.env,
    stdio: "inherit",
  },
);

const built = `${root}/target/wasm32-unknown-unknown/wasm-release/ddalab_wasm.wasm`;
const dest = here("../src/core/ddalab.wasm");
copyFileSync(built, dest);

// Run wasm-opt when binaryen is installed (e.g. in CI or locally) for smaller/faster wasm.
const hasWasmOpt = spawnSync("wasm-opt", ["--version"], { stdio: "ignore" }).status === 0;
if (hasWasmOpt) {
  execFileSync(
    "wasm-opt",
    [
      "-O3",
      "--enable-simd",
      "--enable-bulk-memory",
      "--enable-nontrapping-float-to-int",
      "--enable-sign-ext",
      "--enable-mutable-globals",
      dest,
      "-o",
      dest,
    ],
    { stdio: "inherit" },
  );
}
