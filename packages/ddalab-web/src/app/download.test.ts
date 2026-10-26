// The export spool's sweep and clear, over the in-memory stand-in for the origin private file system and Web Locks.
import { beforeEach, expect, test, vi } from "vitest";
import { memoryOpfs, putFile, type Tree } from "../core/memoryOpfs";
import { clearSpool, sweepSpool } from "./download";

let root: Tree;
beforeEach(() => {
  root = memoryOpfs();
  putFile(root, "exports/fixtures.batch.zip", "a zip");
  putFile(root, "results/r1/manifest.json", "{}");
  putFile(root, "tiles/f/L0.ddt", "tiles");
  putFile(root, "other/keep.txt", "kept");
});

const folders = () => [...root.keys()].sort();
const kept = ["other", "results", "tiles"];

test("the_sweep_removes_the_spool_and_nothing_else", async () => {
  await sweepSpool();
  expect(folders()).toEqual(kept);
  expect((root.get("results") as Tree).has("r1")).toBe(true);
  expect((root.get("tiles") as Tree).has("f")).toBe(true);
});

test("the_sweep_leaves_the_spool_while_a_window_holds_its_lock", async () => {
  let release = () => {};
  const holding = new Promise<void>((done) => (release = done));
  void navigator.locks.request("ddalab-exports", { mode: "shared" }, () => holding);
  await sweepSpool();
  expect(folders()).toEqual(["exports", ...kept]);
  release();
});

test("clear_removes_the_spool_and_nothing_else_whoever_holds_its_lock", async () => {
  void navigator.locks.request("ddalab-exports", { mode: "shared" }, () => new Promise(() => {}));
  await clearSpool();
  expect(folders()).toEqual(kept);
});

test("the_sweep_returns_where_the_page_has_no_web_locks", async () => {
  vi.stubGlobal("navigator", { storage: navigator.storage });
  await expect(sweepSpool()).resolves.toBeUndefined();
  expect(folders()).toEqual(["exports", ...kept]);
});
