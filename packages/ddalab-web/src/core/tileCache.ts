import type { Tile } from "./protocol";

/**
 * Tiles by key, least recently used out first once their bytes pass `maxBytes` (256 MiB by default). `sizeOf` counts
 * a tile's bytes (an extrema tile's buffer by default). The tile just set is never the one evicted.
 */
export class TileCache<T = Tile> {
  /** Each tile with the size it was counted at: a consumer that transfers the bytes empties the buffer. */
  #tiles = new Map<string, { tile: T; size: number }>();
  #bytes = 0;
  #max: number;
  #sizeOf: (tile: T) => number;

  constructor(maxBytes = 256 * 2 ** 20, sizeOf = (tile: T) => (tile as Tile).bytes.byteLength) {
    this.#max = maxBytes;
    this.#sizeOf = sizeOf;
  }

  get(key: string): T | undefined {
    const entry = this.#tiles.get(key);
    if (entry) {
      this.#tiles.delete(key);
      this.#tiles.set(key, entry);
    }
    return entry?.tile;
  }

  /** Whether `key` is kept; unlike `get`, it leaves the order of use alone. */
  has(key: string): boolean {
    return this.#tiles.has(key);
  }

  /** A tile larger than the whole budget is not kept. */
  set(key: string, tile: T): void {
    this.#bytes -= this.#tiles.get(key)?.size ?? 0;
    this.#tiles.delete(key);
    const size = this.#sizeOf(tile);
    if (size > this.#max) return;
    this.#tiles.set(key, { tile, size });
    this.#bytes += size;
    for (const [oldest, old] of this.#tiles) {
      if (this.#bytes <= this.#max) break;
      this.#tiles.delete(oldest);
      this.#bytes -= old.size;
    }
  }
}
