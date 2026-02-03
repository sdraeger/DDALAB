declare module "lz4js" {
  /**
   * Decompress a block of LZ4 data.
   * @param input - The compressed input buffer
   * @param output - The output buffer to write decompressed data to
   * @param sIdx - Start index in input buffer
   * @param eIdx - End index in input buffer
   * @param oIdx - Start index in output buffer
   * @returns The number of bytes written to output
   */
  export function decompressBlock(
    input: Uint8Array,
    output: Uint8Array,
    sIdx: number,
    eIdx: number,
    oIdx: number,
  ): number;

  /**
   * Compress a block of data using LZ4.
   * @param input - The input buffer to compress
   * @param output - The output buffer to write compressed data to
   * @param sIdx - Start index in input buffer
   * @param eIdx - End index in input buffer
   * @param hashTable - Optional hash table for compression
   * @returns The number of bytes written to output
   */
  export function compressBlock(
    input: Uint8Array,
    output: Uint8Array,
    sIdx: number,
    eIdx: number,
    hashTable?: Uint32Array,
  ): number;
}
