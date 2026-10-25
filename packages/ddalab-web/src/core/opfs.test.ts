// The tile file layout against the real core: slots hold exactly the tiles the pyramid emits.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { instantiateCore } from "./abi";
import { levelCount, pyramidBytes, readTile, tileCount, tileSlot, writeTile } from "./opfs";
import { readSynthetic, syntheticEdfSize } from "./synthetic";

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

/** A sync access handle over memory, one per level file. */
function memoryFile(room = Number.POSITIVE_INFINITY) {
  let data = new Uint8Array(0);
  return {
    read(buffer: Uint8Array, { at }: { at: number }) {
      const part = data.subarray(at, at + buffer.length);
      buffer.set(part);
      return part.length;
    },
    // Past `room` bytes of writes the storage is full: the write keeps what fits, then throws.
    write(buffer: Uint8Array, { at }: { at: number }) {
      const kept = buffer.subarray(0, Math.max(0, Math.min(buffer.length, room)));
      room -= kept.length;
      if (data.length < at + kept.length) {
        const grown = new Uint8Array(at + kept.length);
        grown.set(data);
        data = grown;
      }
      data.set(kept, at);
      if (kept.length < buffer.length) throw new DOMException("full", "QuotaExceededError");
      return buffer.length;
    },
  } as unknown as FileSystemSyncAccessHandle;
}

test("stored_tiles_round_trip", () => {
  const slot = tileSlot(3, "I16");
  const files = [memoryFile(), memoryFile(), memoryFile()];
  const skipped = (tile: Uint8Array) => position(tile).level === 0 && position(tile).index === 1;
  for (const tile of tiles) {
    if (!skipped(tile)) writeTile(files[position(tile).level], slot, position(tile).index, tile);
  }
  // Writing level 0 tile 2 left tile 1 as a hole, which reads as unwritten.
  for (const tile of tiles) {
    const read = readTile(files[position(tile).level], slot, position(tile).index);
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
  expect(new Uint8Array(readTile(file, slot, 0) as ArrayBuffer)).toEqual(first);
  expect(readTile(file, slot, 1)).toBeNull();
});
