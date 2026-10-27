import { expect, test } from "vitest";
import { BESIDE } from "./beside";

// A large result's first read builds its pyramid, seconds of OPFS work: the waveform's rows and tiles and a running
// analysis's writes go on meanwhile.
test("result_reads_run_beside_the_engine_queue", () => {
  for (const type of ["resultArray", "resultTile", "resultManifest"] as const)
    expect(BESIDE.has(type)).toBe(true);
  for (const type of ["open", "raw", "tile", "plan", "writeChunks"] as const)
    expect(BESIDE.has(type)).toBe(false);
});
