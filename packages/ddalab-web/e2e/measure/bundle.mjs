// Which JavaScript a production build loads first, and how large each chunk is.
//
// initial_js_gzip = sum of gzip(bytes) over the entry script and the modulepreloads of index.html (check-bundle-size.mjs)
// chunk_gzip[name] = gzip(bytes) of each .js and .css file in assets/, keyed by its name without the content hash
// Sizes in kB of 1000 bytes, as Vite prints them. Appends one JSON line per quantity to <out>, tagged with <label>.
//
// Usage: node e2e/measure/bundle.mjs <dist directory> <out.jsonl> <label>
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { bundleSizes } from "../../scripts/check-bundle-size.mjs";

const [dir, out, label] = process.argv.slice(2);
if (!dir || !out || !label) throw new Error("usage: bundle.mjs <dist directory> <out.jsonl> <label>");
const kB = (bytes) => Number((bytes / 1000).toFixed(2));
const put = (name, value) => appendFileSync(out, `${JSON.stringify({ name, label, value })}\n`);

const { initial } = bundleSizes(dir);
put("initial_js_gzip_kB", kB(initial.reduce((sum, file) => sum + file.gzip, 0)));
put(
  "initial_js_files",
  initial.map((file) => file.name.replace(/-[\w-]{8}\./, ".")),
);
const assets = join(dir, "assets");
const chunks = {};
for (const name of readdirSync(assets).filter((n) => /\.(js|css)$/.test(n) && !n.includes(".worker-"))) {
  chunks[name.replace(/-[\w-]{8}\./, ".")] = kB(gzipSync(readFileSync(join(assets, name))).length);
}
put("chunk_gzip_kB", chunks);
