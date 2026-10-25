import type { Tile } from "./protocol";

/** Tiles by key, least recently used out first once their bytes pass `maxBytes` (256 MiB by default). */
export class TileCache {
  #tiles = new Map<string, Tile>();
  #bytes = 0;
  #max: number;

  constructor(maxBytes = 256 * 2 ** 20) {
    this.#max = maxBytes;
  }

  get(key: string): Tile | undefined {
    const tile = this.#tiles.get(key);
    if (tile) {
      this.#tiles.delete(key);
      this.#tiles.set(key, tile);
    }
    return tile;
  }

  /** A tile larger than the whole budget is not kept. */
  set(key: string, tile: Tile): void {
    this.#bytes -= this.#tiles.get(key)?.bytes.byteLength ?? 0;
    this.#tiles.delete(key);
    if (tile.bytes.byteLength > this.#max) return;
    this.#tiles.set(key, tile);
    this.#bytes += tile.bytes.byteLength;
    for (const [oldest, old] of this.#tiles) {
      if (this.#bytes <= this.#max) break;
      this.#tiles.delete(oldest);
      this.#bytes -= old.bytes.byteLength;
    }
  }
}
