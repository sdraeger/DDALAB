import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { motionLeaks, TOKENS } from "./check-motion.mjs";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-motion-"));
  writeFileSync(join(dir, "tokens.css"), `:root {\n  ${TOKENS.join("\n  ")}\n}\n`);
  writeFileSync(
    join(dir, "a.module.css"),
    ".a { transition-property: opacity, transform; transition-duration: var(--motion-duration); " +
      "transition-timing-function: var(--motion-ease); background: linear-gradient(red, blue); }\n" +
      "/* 200ms ease-in in a comment */",
  );
  writeFileSync(join(dir, "A.tsx"), "const [pending, startTransition] = useTransition();");
});
afterEach(() => rmSync(dir, { recursive: true }));

test("the_app_moves_only_on_the_tokens", () => {
  expect(motionLeaks(SRC)).toEqual([]);
});

test("a_tree_on_the_tokens_passes", () => {
  expect(motionLeaks(dir)).toEqual([]);
});

test.each([
  ["a duration", "b.css", ".b { transition: opacity 200ms var(--motion-ease); }"],
  ["a duration", "b.css", ":root { --slow: 0.3s; }"],
  ["a timing curve", "b.css", ".b { transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }"],
  ["a timing curve", "b.css", ".b { transition: opacity var(--motion-duration) ease-out; }"],
  ["a timing curve", "b.css", ".b { animation-timing-function: linear; }"],
  ["a transition of all", "b.css", ".b { transition: all var(--motion-duration) var(--motion-ease); }"],
  ["a timing curve", "B.tsx", "el.style.easing = 'cubic-bezier(0, 0, 1, 1)';"],
  ["a style transition or animation", "B.tsx", '<div style={{ transition: "opacity 1s" }} />'],
  ["a style transition or animation", "B.ts", "el.style.transitionDuration = '90ms';"],
  ["a script animation", "B.ts", "el.animate([{ opacity: 0 }], 300);"],
])("%s is found in %s", (label, name, code) => {
  writeFileSync(join(dir, name), code);
  expect(motionLeaks(dir)).toEqual([expect.stringContaining(label)]);
});
