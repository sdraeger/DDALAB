import type { Tile } from "./protocol";

/** Tiles by key, least recently used out first once their bytes pass `maxBytes` (256 MiB by default). */
export class TileCache {
  /** Each tile with the size it was counted at: a consumer that transfers the bytes empties the buffer. */
  #tiles = new Map<string, { tile: Tile; size: number }>();
  #bytes = 0;
  #max: number;

  constructor(maxBytes = 256 * 2 ** 20) {
    this.#max = maxBytes;
  }

  get(key: string): Tile | undefined {
    const entry = this.#tiles.get(key);
    if (entry) {
      this.#tiles.delete(key);
      this.#tiles.set(key, entry);
    }
    return entry?.tile;
  }

  /** A tile larger than the whole budget is not kept. */
  set(key: string, tile: Tile): void {
    this.#bytes -= this.#tiles.get(key)?.size ?? 0;
    this.#tiles.delete(key);
    const size = tile.bytes.byteLength;
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
