// The tile file layout against the real core: slots hold exactly the tiles the pyramid emits. Eviction of the tiles of
// the least recently used recordings.
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { instantiateCore } from "./abi";
import { memoryOpfs, putFile, type Tree } from "./memoryOpfs";
import {
  evictTiles,
  levelCount,
  pyramidBytes,
  readTile,
  type TileId,
  tileCount,
  tileSlot,
  tilesLock,
  writeTile,
} from "./opfs";
import { readSynthetic, syntheticEdfSize } from "./synthetic";

test("eviction_drops_the_least_recently_used_tiles_but_not_an_open_recordings_or_results", async () => {
  const root = memoryOpfs();
  try {
    // Four recordings' tiles of 101 bytes each (a level file and the time they were last used), oldest first.
    for (const [used, fingerprint] of ["old", "open", "mid", "new"].entries()) {
      putFile(root, `tiles/${fingerprint}/L0.ddt`, new Uint8Array(100));
      putFile(root, `tiles/${fingerprint}/used.json`, String(used));
    }
    putFile(root, "results/r/manifest.json", "{}");
    let release = () => {};
    void navigator.locks.request(
      tilesLock("open"),
      { mode: "shared" },
      () => new Promise<void>((done) => (release = done)),
    );
    expect(await evictTiles(250)).toBe(202);
    expect([...(root.get("tiles") as Tree).keys()].sort()).toEqual(["new", "open"]);
    expect(root.has("results")).toBe(true);
    release();
    expect(await evictTiles(0)).toBe(0);
    expect([...(root.get("tiles") as Tree).keys()]).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

const wasm = new WebAssembly.Module(readFileSync(new URL("./ddalab.wasm", import.meta.url)));
const spec = { channels: 3, rateHz: 100, durationS: 4000, seed: 7 };
const core = await instantiateCore(wasm, (_, offset, dst) => readSynthetic(spec, offset, dst));
const { handle, info } = core.open({
  primary: "synthetic.edf",
  files: [{ name: "synthetic.edf", file_id: 1, len: syntheticEdfSize(spec) }],
});
const rows = info.sample_count;
const pyramid = core.pyramid(handle);
const tiles = [...pyramid.push(0, rows), ...pyramid.finish()].map((tile) => new Uint8Array(tile));
const position = (tile: Uint8Array) => {
  const view = new DataView(tile.buffer);
  return { level: view.getUint32(4, true), index: Number(view.getBigUint64(8, true)) };
};

test("geometry_matches_the_core", () => {
  const levels = levelCount(rows);
  expect(levels).toBe(3);
  const expected = Array.from({ length: levels }, (_, level) =>
    Array.from({ length: tileCount(rows, level) }, (_, index) => `${level}/${index}`),
  ).flat();
  const emitted = tiles.map((tile) => `${position(tile).level}/${position(tile).index}`);
  expect(emitted.sort()).toEqual(expected.sort());
  const slot = tileSlot(3, "I16");
  for (const tile of tiles) expect(tile.length).toBeLessThanOrEqual(slot);
  expect(tiles.some((tile) => tile.length === slot)).toBe(true);
  expect(tiles.reduce((sum, tile) => sum + tile.length, 0)).toBe(pyramidBytes(rows, 3, "I16"));
});

/**
 * A sync access handle over memory, one per level file. Past `room` bytes of writes the storage is full: the write
 * keeps what fits, then throws `QuotaExceededError`, or with `quiet` returns the short count.
 */
function memoryFile(room = Number.POSITIVE_INFINITY, quiet = false) {
  let data = new Uint8Array(0);
  return {
    read(buffer: Uint8Array, { at }: { at: number }) {
      const part = data.subarray(at, at + buffer.length);
      buffer.set(part);
      return part.length;
    },
    write(buffer: Uint8Array, { at }: { at: number }) {
      const kept = buffer.subarray(0, Math.max(0, Math.min(buffer.length, room)));
      room -= kept.length;
      if (data.length < at + kept.length) {
        const grown = new Uint8Array(at + kept.length);
        grown.set(data);
        data = grown;
      }
      data.set(kept, at);
      if (kept.length < buffer.length && !quiet) throw new DOMException("full", "QuotaExceededError");
      return kept.length;
    },
  } as unknown as FileSystemSyncAccessHandle;
}

/** The tile as a recording of three I16 channels asks for it. */
const want = (tile: Uint8Array): TileId => ({ ...position(tile), channels: 3, rawType: "I16" });

test("stored_tiles_round_trip", () => {
  const slot = tileSlot(3, "I16");
  const files = [memoryFile(), memoryFile(), memoryFile()];
  const skipped = (tile: Uint8Array) => position(tile).level === 0 && position(tile).index === 1;
  for (const tile of tiles) {
    if (!skipped(tile)) writeTile(files[position(tile).level], slot, position(tile).index, tile);
  }
  // Writing level 0 tile 2 left tile 1 as a hole, which reads as unwritten.
  for (const tile of tiles) {
    const read = readTile(files[position(tile).level], want(tile));
    if (skipped(tile)) expect(read).toBeNull();
    else expect(new Uint8Array(read as ArrayBuffer)).toEqual(tile);
  }
});

// A tile that does not fit leaves what its body wrote but no header: it reads as unwritten, earlier tiles are intact.
test("full_storage_keeps_earlier_tiles", () => {
  const slot = tileSlot(3, "I16");
  const [first, second] = tiles.filter((tile) => position(tile).level === 0);
  const file = memoryFile(first.length + 1000);
  writeTile(file, slot, 0, first);
  expect(() => writeTile(file, slot, 1, second)).toThrow("full");
  expect(new Uint8Array(readTile(file, want(first)) as ArrayBuffer)).toEqual(first);
  expect(readTile(file, want(second))).toBeNull();
});

test("a_short_write_is_a_full_storage", () => {
  const [first] = tiles;
  const file = memoryFile(first.length / 2, true);
  expect(() => writeTile(file, tileSlot(3, "I16"), 0, first)).toThrow(
    expect.objectContaining({ name: "QuotaExceededError" }),
  );
  expect(readTile(file, want(first))).toBeNull();
});

// Tiles are kept under a fingerprint that does not pin every byte: a slot is served only when its header names
// the level, index, channels and sample type asked for.
test("a_slot_of_another_recording_is_not_served", () => {
  const [tile] = tiles.filter((t) => position(t).level === 0);
  const asked = want(tile);
  const file = memoryFile();
  writeTile(file, tileSlot(3, "I16"), 0, tile);
  expect(readTile(file, asked)).not.toBeNull();
  // Another channel count, read from the slot position that count has (index 0 starts at byte 0 for all).
  expect(readTile(file, { ...asked, channels: 2 })).toBeNull();
  expect(readTile(file, { ...asked, channels: 4 })).toBeNull();
  expect(readTile(file, { ...asked, rawType: "I32" })).toBeNull();
  expect(readTile(file, { ...asked, rawType: "F32" })).toBeNull();
  expect(readTile(file, { ...asked, level: 1 })).toBeNull();
  // Level 0 tile 0 stored where tile 1 belongs.
  writeTile(file, tileSlot(3, "I16"), 1, tile);
  expect(readTile(file, { ...asked, index: 1 })).toBeNull();
  // A tile of three channels in the slot of a two-channel recording's tile 1.
  const narrow = memoryFile();
  writeTile(narrow, tileSlot(2, "I16"), 1, tiles.find((t) => position(t).index === 1) as Uint8Array);
  expect(readTile(narrow, { level: 0, index: 1, channels: 2, rawType: "I16" })).toBeNull();
});
