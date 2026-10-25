import { expect, test } from "vitest";
import type { Tile } from "./protocol";
import { TileCache } from "./tileCache";

const tile = (index: number, bytes: number): Tile => ({ level: 0, index, bytes: new ArrayBuffer(bytes) });

test("evicts_least_recent", () => {
  const cache = new TileCache(100);
  cache.set("a", tile(0, 40));
  cache.set("b", tile(1, 40));
  expect(cache.get("a")?.index).toBe(0); // a is now more recent than b
  cache.set("c", tile(2, 40));
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")?.index).toBe(0);
  expect(cache.get("c")?.index).toBe(2);
});

// A consumer that transfers a tile's buffer leaves it empty; the cache still frees what it counted.
test("detached_tile_frees_its_counted_bytes", () => {
  const cache = new TileCache(100);
  const first = tile(0, 40);
  cache.set("a", first);
  structuredClone(first.bytes, { transfer: [first.bytes] });
  expect(first.bytes.byteLength).toBe(0);
  cache.set("b", tile(1, 40));
  cache.set("c", tile(2, 40)); // 120 counted: a goes, 80 remain
  expect(cache.get("a")).toBeUndefined();
  cache.set("d", tile(3, 20));
  expect(cache.get("b")).toBeDefined();
  expect(cache.get("c")).toBeDefined();
  expect(cache.get("d")).toBeDefined();
});

test("respects_byte_budget", () => {
  const cache = new TileCache(100);
  // Setting a key again replaces its tile: the old bytes do not count twice.
  cache.set("a", tile(0, 40));
  cache.set("a", tile(0, 40));
  cache.set("b", tile(1, 40));
  expect(cache.get("a")).toBeDefined();
  expect(cache.get("b")).toBeDefined();
  // A tile larger than the whole budget is not kept.
  cache.set("big", tile(2, 200));
  expect(cache.get("big")).toBeUndefined();
  cache.set("c", tile(3, 40));
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")?.index).toBe(1);
  expect(cache.get("c")?.index).toBe(3);
});

// The heatmap's result tiles: counted by their values, the newest kept while older ones make room.
test("counts_any_tile_by_its_size", () => {
  const cache = new TileCache<{ values: Float32Array }>(100, (tile) => tile.values.byteLength);
  const cells = (n: number) => ({ values: new Float32Array(n) });
  cache.set("a", cells(10));
  cache.set("b", cells(10));
  cache.set("c", cells(20)); // 160 bytes counted: a and b go
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("c")?.values).toHaveLength(20);
  cache.set("d", cells(25)); // exactly the budget: everything older goes, d stays
  expect(cache.get("c")).toBeUndefined();
  expect(cache.get("d")?.values).toHaveLength(25);
});
