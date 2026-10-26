import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { bakeServiceWorker, precacheOf } from "./precache.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "precache-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  writeFileSync(join(dir, "manifest.webmanifest"), "{}");
  writeFileSync(join(dir, "assets", "app-1.js"), "export {};");
  writeFileSync(join(dir, "assets", "engine.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFileSync(join(dir, ".htaccess"), "Header unset Expires");
  writeFileSync(join(dir, ".ddalab-web"), "marker");
});
afterEach(() => rmSync(dir, { recursive: true }));

test("the_list_holds_every_visible_file_but_the_worker", () => {
  writeFileSync(join(dir, "sw.js"), "const BUILD = {};");
  expect(precacheOf(dir).files).toEqual([
    "assets/app-1.js",
    "assets/engine.wasm",
    "index.html",
    "manifest.webmanifest",
  ]);
});

test("the_version_is_stable_and_follows_every_file", () => {
  const { version } = precacheOf(dir);
  expect(version).toMatch(/^[0-9a-f]{12}$/);
  expect(precacheOf(dir).version).toBe(version);
  writeFileSync(join(dir, "sw.js"), "const BUILD = {};");
  writeFileSync(join(dir, ".htaccess"), "changed");
  expect(precacheOf(dir).version).toBe(version); // the worker and hidden files do not count

  writeFileSync(join(dir, "manifest.webmanifest"), '{"name":"changed"}');
  const changed = precacheOf(dir).version;
  expect(changed).not.toBe(version);
  writeFileSync(join(dir, "extra.png"), "");
  expect(precacheOf(dir).version).not.toBe(changed);
});

test("baking_writes_the_list_into_the_worker", () => {
  bakeServiceWorker(dir);
  const baked = readFileSync(join(dir, "sw.js"), "utf8");
  const line = baked.split("\n").find((l) => l.startsWith("const BUILD = "));
  expect(JSON.parse(line.slice("const BUILD = ".length, -1))).toEqual(precacheOf(dir));
  // The worker is not in its own list, so baking again changes nothing.
  bakeServiceWorker(dir);
  expect(readFileSync(join(dir, "sw.js"), "utf8")).toBe(baked);
});
