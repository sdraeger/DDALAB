// Fails the build when dist holds what only dev and e2e builds may have: the `__ddalab` test hook, the IO worker's
// trap and quota hooks, the workers' wasm memory hook, the synthetic recording generator, or a wasm module other than
// the engine's own .wasm asset.
// Usage: node scripts/check-dist.mjs [dist directory]
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `\0asm` and version 1: the start of every wasm module. */
const MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** What minified code leaves of each dev-only piece: a string or property name that survives. */
const FORBIDDEN = [
  ["the __ddalab test hook", "__ddalab"],
  ["the trap hook", "exports.trap"],
  ["the storage quota hook", "The quota was exceeded"],
  ["the wasm memory hook", "wasmBytes"],
  ["the synthetic recording generator", "Startdate 01-JAN-2020"],
  ["the synthetic recording generator", "synthetic.edf"],
  ["the synthetic recording generator", "-3276.8"],
  ["the synthetic recording generator", "EDF+C"],
  // A wasm module written into code: as a byte list, as a string or as base64.
  ["wasm bytes in code", /0,\s*97,\s*115,\s*109,\s*1,\s*0,\s*0,\s*0/],
  ["wasm bytes in code", /\\0asm|\\x00asm|AGFzbQEAAAA/],
];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** One line per forbidden thing found in `dir`; empty when it is clean. */
export function findLeaks(dir) {
  const found = [];
  for (const path of files(dir)) {
    const bytes = readFileSync(path);
    if (path.endsWith(".wasm")) {
      if (!bytes.subarray(0, MAGIC.length).equals(MAGIC))
        found.push(`${path}: a .wasm file that is not a wasm module`);
      continue;
    }
    if (bytes.includes(MAGIC)) found.push(`${path}: wasm bytes outside a .wasm asset`);
    const text = bytes.toString("latin1");
    for (const [label, pattern] of FORBIDDEN) {
      if (typeof pattern === "string" ? text.includes(pattern) : pattern.test(text))
        found.push(`${path}: ${label}`);
    }
  }
  return found;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const dir = process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));
  const found = findLeaks(dir);
  for (const line of found) console.error(line);
  if (found.length > 0) process.exit(1);
  console.log(`${dir} holds no test hooks`);
}
