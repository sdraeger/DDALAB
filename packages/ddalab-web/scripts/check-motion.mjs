// Fails when the source sets a duration or a timing curve other than the motion tokens of src/styles/tokens.css, or
// transitions `all`. Style sheets may name no time and no curve outside the two token definitions; components may set
// no transition or animation in their styles at all. vitest runs it (check-motion.test.mjs).
// Usage: node scripts/check-motion.mjs [src directory]
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The only places a duration and a curve are written. */
export const TOKENS = ["--motion-duration: 160ms;", "--motion-ease: cubic-bezier(0.23, 1, 0.32, 1);"];

const CSS = [
  ["a duration", /(?<![\w.#-])\d*\.?\d+m?s\b/g],
  ["a timing curve", /cubic-bezier\(|steps\(|(?<![\w-])(?:ease(?:-in-out|-in|-out)?|linear)(?![\w(-])/g],
  ["a transition of all", /transition(?:-property)?\s*:\s*all\b/g],
];
const SCRIPT = [
  ["a timing curve", /cubic-bezier\(/g],
  [
    "a style transition or animation",
    /\b(?:transition|animation)(?:Duration|TimingFunction|Property|Name)?\s*[:=]\s*["'`]/g,
  ],
  ["a script animation", /\.animate\(/g],
];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** One line per motion value in `dir` that is not a token; empty when it is clean. */
export function motionLeaks(dir) {
  const found = [];
  for (const path of files(dir)) {
    const name = relative(dir, path);
    const css = path.endsWith(".css");
    if (!css && !/\.tsx?$/.test(path)) continue;
    let text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    if (css) for (const token of TOKENS) text = text.replace(token, "");
    for (const [label, pattern] of css ? CSS : SCRIPT) {
      for (const match of text.matchAll(pattern)) found.push(`${name}: ${label} (${match[0].trim()})`);
    }
  }
  return found;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const dir = process.argv[2] ?? fileURLToPath(new URL("../src", import.meta.url));
  const found = motionLeaks(dir);
  for (const line of found) console.error(line);
  if (found.length > 0) process.exit(1);
  console.log(`${dir} moves only on the motion tokens`);
}
