// Builds the engine's wasm ABI and copies it to src/core/ddalab.wasm, which is a build artifact (gitignored).
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const crate = here("../../ddalab-wasm");

execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "ddalab-wasm"], {
  cwd: crate,
  stdio: "inherit",
});
copyFileSync(
  `${crate}/target/wasm32-unknown-unknown/release/ddalab_wasm.wasm`,
  here("../src/core/ddalab.wasm"),
);
