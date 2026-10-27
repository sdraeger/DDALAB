// The files a build's service worker keeps (public/sw.js) and the version they make. The production build bakes both
// into dist/sw.js (vite.config.ts); the update test bakes a changed copy of dist the same way.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const TEMPLATE = new URL("../public/sw.js", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The files of the build in `dir`, as paths from it with `/`, sorted, and the version: the first 12 hex digits of the
 * SHA-256 over each path and the SHA-256 of its bytes, and over the worker's own template (`template`, public/sw.js),
 * so that a change of the worker alone makes a new version and a new cache name. The worker and hidden files (the
 * .htaccess) are not among the files. Any changed, added or removed file makes a new version.
 */
export function precacheOf(dir, template = TEMPLATE) {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => path !== "sw.js" && !path.split("/").some((part) => part.startsWith(".")))
    .sort();
  const text =
    files.map((file) => `${file} ${sha256(readFileSync(join(dir, file)))}\n`).join("") +
    `sw.js ${sha256(readFileSync(template))}\n`;
  return { version: sha256(text).slice(0, 12), files };
}

/** Writes `dir/sw.js`: public/sw.js with the version and files of `dir` in place of its BUILD line. */
export function bakeServiceWorker(dir) {
  const source = readFileSync(TEMPLATE, "utf8");
  const baked = source.replace(
    /^const BUILD = .*;$/m,
    () => `const BUILD = ${JSON.stringify(precacheOf(dir))};`,
  );
  if (baked === source) throw new Error("public/sw.js has no BUILD line to bake");
  writeFileSync(join(dir, "sw.js"), baked);
}
