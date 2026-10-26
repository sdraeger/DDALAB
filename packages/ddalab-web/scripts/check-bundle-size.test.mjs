import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { bundleSizes, LIMIT_BYTES } from "./check-bundle-size.mjs";

const SCRIPT = fileURLToPath(new URL("check-bundle-size.mjs", import.meta.url));
const HTML = `<!doctype html><head>
<script type="module" crossorigin src="./assets/entry.js"></script>
<link rel="modulepreload" crossorigin href="./assets/shared.js">
<link rel="stylesheet" crossorigin href="./assets/entry.css">
</head><body><div id="root"></div></body>`;

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-size-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), HTML);
  writeFileSync(join(dir, "assets", "entry.js"), "export const entry = 1;");
  writeFileSync(join(dir, "assets", "shared.js"), "export const shared = 2;");
  writeFileSync(join(dir, "assets", "entry.css"), "body{}");
  writeFileSync(join(dir, "assets", "lazy.js"), "export const lazy = 3;");
  writeFileSync(join(dir, "assets", "engine.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
});
afterEach(() => rmSync(dir, { recursive: true }));

const run = (script = SCRIPT) => {
  try {
    return { status: 0, out: execFileSync("node", [script, dir], { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    return { status: error.status, out: error.stdout + error.stderr };
  }
};

test("counts_the_scripts_and_preloads_the_entry_loads", () => {
  const { initial } = bundleSizes(dir);
  expect(initial.map((file) => file.name)).toEqual(["assets/entry.js", "assets/shared.js"]);
});

test("wasm_is_listed_apart", () => {
  const { initial, wasm } = bundleSizes(dir);
  expect(wasm.map((file) => file.name)).toEqual(["assets/engine.wasm"]);
  expect(initial.map((file) => file.name)).not.toContain("assets/engine.wasm");
});

test("under_the_limit_passes_and_reports", () => {
  const { status, out } = run();
  expect(status).toBe(0);
  expect(out).toMatch(/initial JS: .* gzip of 200\.00 kB \(assets\/entry\.js, assets\/shared\.js\)/);
  expect(out).toMatch(/wasm: .*assets\/engine\.wasm/);
});

test("over_the_limit_fails", () => {
  // Random bytes do not compress: the gzip size is about the file size.
  writeFileSync(join(dir, "assets", "shared.js"), randomBytes(LIMIT_BYTES + 1000));
  const { status, out } = run();
  expect(status).toBe(1);
  expect(out).toMatch(/over the limit/);
});

test("an_entry_without_scripts_fails", () => {
  writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
  expect(run().status).toBe(1);
});

// Started through a symlink (an npm bin link, a checkout reached by a link) the script must still run its check.
test("a_symlinked_script_path_still_gates", () => {
  const link = join(dir, "linked-check-bundle-size.mjs");
  symlinkSync(SCRIPT, link);
  writeFileSync(join(dir, "assets", "shared.js"), randomBytes(LIMIT_BYTES + 1000));
  expect(run(link).status).toBe(1);
});
