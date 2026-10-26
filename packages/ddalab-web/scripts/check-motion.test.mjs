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
  writeFileSync(
    join(dir, "A.tsx"),
    'const [pending, startTransition] = useTransition();\nel.style.transition = "none";\n' +
      "const transition = document.startViewTransition(update);",
  );
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
  ["a duration", "b.css", ".b { transition: opacity 200MS var(--motion-ease); }"],
  ["a timing curve", "b.css", ".b { transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }"],
  ["a timing curve", "b.css", ".b { transition: opacity var(--motion-duration) ease-out; }"],
  ["a timing curve", "b.css", ".b { animation-timing-function: linear; }"],
  ["a timing curve", "b.css", ".b { transition-timing-function: linear(0, 0.5, 1); }"],
  ["a timing curve", "b.css", ".b { transition-timing-function: step-end; }"],
  ["a timing curve", "b.css", ".b { transition-timing-function: STEP-START; }"],
  ["a transition of all", "b.css", ".b { transition: all var(--motion-duration) var(--motion-ease); }"],
  ["a transition of all", "b.css", ".b { transition-property: opacity, all; }"],
  [
    "a transition of all",
    "b.css",
    ".b {\n  transition:\n    opacity var(--motion-duration) var(--motion-ease),\n    all var(--motion-duration);\n}",
  ],
  ["a delay", "b.css", ".b { transition-delay: var(--motion-duration); }"],
  ["a delay", "b.css", ".b { animation-delay: var(--motion-duration); }"],
  ["a timing curve", "B.tsx", "el.style.easing = 'cubic-bezier(0, 0, 1, 1)';"],
  ["a style transition or animation", "B.tsx", '<div style={{ transition: "opacity 1s" }} />'],
  ["a style transition or animation", "B.ts", "el.style.transitionDuration = '90ms';"],
  ["a style transition or animation", "B.ts", "el.style.transitionDelay = '1s';"],
  ["a style string with a duration or curve", "B.ts", 'el.style.setProperty("transition", "opacity 200ms");'],
  ["a style string with a duration or curve", "B.ts", 'el.style.cssText = "transition: opacity .2s ease";'],
  ["a script animation", "B.ts", "el.animate([{ opacity: 0 }], 300);"],
])("%s is found in %s", (label, name, code) => {
  writeFileSync(join(dir, name), code);
  expect(motionLeaks(dir)).toEqual([expect.stringContaining(label)]);
});
