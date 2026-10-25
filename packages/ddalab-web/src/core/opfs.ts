// The tile pyramid on disk: its geometry (mirrors dda-rs `tiles.rs`) and the origin private file system files that
// hold it. /tiles/<fingerprint>/L<level>.ddt keeps the tiles of one level in slots of `tileSlot` bytes, tile `i` at
// `i * slot`; the unwritten rest of a slot is zeros. A slot is written body first and header last: a slot without a
// header is not a tile, whatever a crash left in it. Sync access handles exist in workers only.
import type { RawType } from "./types";

const BASE_BUCKET = 64;
const FANOUT = 4;
const TILE_BUCKETS = 1024;
const HEADER = 32;
const MAGIC = [0x44, 0x44, 0x54, 0x31]; // DDT1

/** Rows per bucket at `level`. */
export const bucketSize = (level: number) => BASE_BUCKET * FANOUT ** level;

/** Rows a full tile of `level` covers. */
export const tileRows = (level: number) => TILE_BUCKETS * bucketSize(level);

/** The smallest `n` for which level `n - 1` holds all `rows` in one tile. */
export function levelCount(rows: number): number {
  let n = 1;
  while (tileRows(n - 1) < rows) n++;
  return n;
}

export const tileCount = (rows: number, level: number) =>
  Math.ceil(Math.ceil(rows / bucketSize(level)) / TILE_BUCKETS);

/** Bytes per stored value: the tile keeps the source type, widened to 4 bytes except for int16. */
const width = (type: RawType) => (type === "I16" ? 2 : 4);

/** The bytes of a tile with all its buckets. */
export const tileSlot = (channels: number, type: RawType) =>
  HEADER + 2 * TILE_BUCKETS * channels * width(type);

/** The bytes of every tile of the recording. */
export function pyramidBytes(rows: number, channels: number, type: RawType): number {
  let total = 0;
  for (let level = 0; level < levelCount(rows); level++) {
    total +=
      tileCount(rows, level) * HEADER + Math.ceil(rows / bucketSize(level)) * channels * 2 * width(type);
  }
  return total;
}

/** The pyramid does not fit in the browser's storage; `neededBytes` is the size of all of it. */
export class QuotaError extends Error {
  neededBytes: number;

  constructor(neededBytes: number) {
    const gb = (neededBytes / 1e9).toLocaleString("en", { maximumSignificantDigits: 2 });
    super(
      `The overview needs about ${gb} GB of browser storage, more than is available. Free up space and open the recording again.`,
    );
    this.neededBytes = neededBytes;
  }
}

/** Whether this window gives workers a file system; some windows (private browsing) do not. */
export const hasStorage = () =>
  navigator.storage.getDirectory().then(
    () => true,
    () => false,
  );

async function directory(fingerprint: string) {
  const tiles = await (await navigator.storage.getDirectory()).getDirectoryHandle("tiles", { create: true });
  return tiles.getDirectoryHandle(fingerprint, { create: true });
}

/** The file of `level`'s tiles. The handle is exclusive: the caller closes it. */
export async function tileFile(fingerprint: string, level: number): Promise<FileSystemSyncAccessHandle> {
  const file = await (await directory(fingerprint)).getFileHandle(`L${level}.ddt`, { create: true });
  // Another tab holds the file for the milliseconds of a write, or the page that was just reloaded has not let go.
  for (let attempt = 0; ; attempt++) {
    try {
      return await file.createSyncAccessHandle();
    } catch (error) {
      const busy = error instanceof DOMException && error.name === "NoModificationAllowedError";
      if (!busy || attempt === 40) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** Runs the tasks of one worker one after another: a level file has one handle at a time. */
let turn: Promise<unknown> = Promise.resolve();
const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
  const run = turn.then(task);
  turn = run.catch(() => {});
  return run;
};

/** The order of the type tags in a tile header (`RAW_TYPES` in `tiles.rs`). */
const RAW_TYPES: RawType[] = ["I16", "I24", "I32", "F32", "F64"];

/** A tile of a recording with `channels` display channels of the given sample type. */
export interface TileId {
  level: number;
  index: number;
  channels: number;
  rawType: RawType;
}

/**
 * The tile `want` in an open level file, or `null` when its slot holds none or holds another: a header that does
 * not name this level, index, channel count and sample type (tiles of another recording that shares the key).
 */
export function readTile(file: FileSystemSyncAccessHandle, want: TileId): ArrayBuffer | null {
  const slot = tileSlot(want.channels, want.rawType);
  const at = want.index * slot;
  const head = new Uint8Array(HEADER);
  if (file.read(head, { at }) < HEADER || MAGIC.some((byte, i) => head[i] !== byte)) return null;
  const view = new DataView(head.buffer);
  const [level, index, channels, buckets] = [
    view.getUint32(4, true),
    Number(view.getBigUint64(8, true)),
    view.getUint32(16, true),
    view.getUint32(20, true),
  ];
  if (level !== want.level || index !== want.index || channels !== want.channels) return null;
  if (head[24] !== RAW_TYPES.indexOf(want.rawType) || buckets === 0 || buckets > TILE_BUCKETS) return null;
  const body = 2 * channels * buckets * width(want.rawType);
  const tile = new Uint8Array(HEADER + body);
  tile.set(head);
  return file.read(tile.subarray(HEADER), { at: at + HEADER }) === body ? tile.buffer : null;
}

/** Writes all of `bytes` at `at`; the storage taking fewer is a full storage. */
export function put(file: FileSystemSyncAccessHandle, bytes: Uint8Array, at: number) {
  const wrote = file.write(bytes, { at });
  if (wrote !== bytes.length) {
    throw new DOMException(`The storage took ${wrote} of ${bytes.length} bytes`, "QuotaExceededError");
  }
}

/** Throws `QuotaExceededError` when the storage is full. */
export function writeTile(file: FileSystemSyncAccessHandle, slot: number, index: number, tile: Uint8Array) {
  const at = index * slot;
  put(file, tile.subarray(HEADER), at + HEADER);
  put(file, tile.subarray(0, HEADER), at);
}

/** Stores encoded tiles, each in the file of its level. */
export function saveTiles(fingerprint: string, slot: number, tiles: ArrayBuffer[]) {
  const levels = new Map<number, ArrayBuffer[]>();
  for (const tile of tiles) {
    const level = new DataView(tile).getUint32(4, true);
    levels.set(level, [...(levels.get(level) ?? []), tile]);
  }
  return inTurn(async () => {
    for (const [level, group] of levels) {
      const file = await tileFile(fingerprint, level);
      try {
        for (const tile of group) {
          writeTile(file, slot, Number(new DataView(tile).getBigUint64(8, true)), new Uint8Array(tile));
        }
        file.flush();
      } finally {
        file.close();
      }
    }
  });
}

/** The stored tile `want`, or `null`. */
export const loadTile = (fingerprint: string, want: TileId) =>
  inTurn(async () => {
    const file = await tileFile(fingerprint, want.level);
    try {
      return readTile(file, want);
    } finally {
      file.close();
    }
  });

/** A small JSON record next to the tiles; `undefined` when there is none or it cannot be read. */
export async function readJson(fingerprint: string, name: string): Promise<unknown> {
  try {
    const file = await (await directory(fingerprint)).getFileHandle(name);
    const handle = await file.createSyncAccessHandle();
    try {
      const bytes = new Uint8Array(handle.getSize());
      handle.read(bytes, { at: 0 });
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
      handle.close();
    }
  } catch {
    return undefined;
  }
}

export async function writeJson(fingerprint: string, name: string, value: unknown) {
  const file = await (await directory(fingerprint)).getFileHandle(name, { create: true });
  const handle = await file.createSyncAccessHandle();
  try {
    handle.truncate(0);
    put(handle, new TextEncoder().encode(JSON.stringify(value)), 0);
    handle.flush();
  } finally {
    handle.close();
  }
}
