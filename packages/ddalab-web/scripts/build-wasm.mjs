// Builds the engine's wasm ABI and copies it to src/core/ddalab.wasm, which is a build artifact (gitignored).
// The build records `git rev-parse HEAD` as version().git_commit; without git the field stays null.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const crate = here("../../ddalab-wasm");

let commit;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: crate,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  commit = undefined;
}

execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "ddalab-wasm"], {
  cwd: crate,
  env: commit ? { ...process.env, DDALAB_GIT_COMMIT: commit } : process.env,
  stdio: "inherit",
});
copyFileSync(
  `${crate}/target/wasm32-unknown-unknown/release/ddalab_wasm.wasm`,
  here("../src/core/ddalab.wasm"),
);
