// Fails when the source sets a duration, a delay or a timing curve other than the motion tokens of
// src/styles/tokens.css, or transitions `all`. Style sheets may name no time and no curve outside the two token
// definitions; components may set no transition or animation in their styles at all (`none` aside). vitest runs it
// (check-motion.test.mjs).
// Usage: node scripts/check-motion.mjs [src directory]
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The only places a duration and a curve are written. */
export const TOKENS = ["--motion-duration: 160ms;", "--motion-ease: cubic-bezier(0.23, 1, 0.32, 1);"];

/** A time in any case of its unit, and a timing function: a curve, steps or a keyword (`linear-gradient` is none). */
const DURATION = String.raw`(?<![\w.#-])\d*\.?\d+m?s\b`;
const CURVE = String.raw`cubic-bezier\(|steps\(|(?<![\w-])(?:ease(?:-in-out|-in|-out)?|linear|step-start|step-end)(?![\w-])`;

const CSS = [
  ["a duration", new RegExp(DURATION, "gi")],
  ["a timing curve", new RegExp(CURVE, "gi")],
  ["a transition of all", /transition(?:-property)?\s*:[^;}]*(?<![\w-])all(?![\w-])/gi],
  ["a delay", /(?:transition|animation)-delay\s*:/gi],
];
const SCRIPT = [
  ["a timing curve", /cubic-bezier\(/gi],
  [
    "a style transition or animation",
    /\b(?:transition|animation)(?:Duration|TimingFunction|Property|Name|Delay)?\s*[:=]\s*["'`](?!none["'`])/g,
  ],
  [
    "a style string with a duration or curve",
    new RegExp(String.raw`(?:setProperty\([^)]*|cssText\s*\+?=[^;\n]*)(?:${DURATION}|${CURVE})`, "gi"),
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
