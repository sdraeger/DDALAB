// Fails the build when the JavaScript the entry HTML loads exceeds 200 kB gzipped. That is the module scripts and
// modulepreload links of index.html: the entry chunk and the chunks it imports statically. kB is 1000 bytes, as Vite
// prints it. Lazy chunks and workers load later and are not counted. The engine's wasm module has no limit; the
// script reports its size.
// Usage: node scripts/check-bundle-size.mjs [dist directory]
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const LIMIT_BYTES = 200_000;

const gzipped = (bytes) => gzipSync(bytes).length;

/** Names and sizes of what `dir` holds: the initial JS in the order the entry HTML lists it, and the wasm modules. */
export function bundleSizes(dir) {
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
  const initial = tags
    .filter((tag) => tag.startsWith("<script") || /\brel="modulepreload"/.test(tag))
    .map((tag) => /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1])
    .filter((url) => url !== undefined)
    .map((url) => new URL(url, "http://dist/").pathname.slice(1));
  const sizeOf = (name) => {
    const bytes = readFileSync(join(dir, name));
    return { name, bytes: bytes.length, gzip: gzipped(bytes) };
  };
  return {
    initial: initial.map(sizeOf),
    wasm: readdirSync(dir, { recursive: true })
      .filter((name) => name.endsWith(".wasm"))
      .map(sizeOf),
  };
}

const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const dir = process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));
  const { initial, wasm } = bundleSizes(dir);
  if (initial.length === 0) {
    console.error(`${join(dir, "index.html")} loads no script`);
    process.exit(1);
  }
  const total = initial.reduce((sum, file) => sum + file.gzip, 0);
  console.log(
    `initial JS: ${kB(total)} gzip of ${kB(LIMIT_BYTES)} (${initial.map((f) => f.name).join(", ")})`,
  );
  for (const { name, bytes, gzip } of wasm) console.log(`wasm: ${kB(bytes)}, ${kB(gzip)} gzip (${name})`);
  if (total > LIMIT_BYTES) {
    console.error(`the initial JS is ${kB(total - LIMIT_BYTES)} over the limit`);
    process.exit(1);
  }
}
