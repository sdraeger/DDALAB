import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { findLeaks } from "./check-dist.mjs";

const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-dist-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  writeFileSync(join(dir, "assets", "engine.wasm"), Buffer.from([...MAGIC, 1, 2, 3]));
  writeFileSync(join(dir, "assets", "app.js"), "export const version = () => fetch('engine.wasm');");
});
afterEach(() => rmSync(dir, { recursive: true }));

test("a_clean_dist_passes", () => {
  expect(findLeaks(dir)).toEqual([]);
});

test.each([
  ["the __ddalab test hook", "window.__ddalab={engine}"],
  ["the trap hook", "new WebAssembly.Instance(m).exports.trap()"],
  ["the storage quota hook", "throw new DOMException('The quota was exceeded','QuotaExceededError')"],
  ["the wasm memory hook", "self.postMessage({wasmBytes:c.memoryBytes()})"],
  ["the synthetic recording generator", "put(88,'Startdate 01-JAN-2020 X X X',80)"],
  ["the synthetic recording generator", "files:[{name:'synthetic.edf',size:n}]"],
  ["the synthetic recording generator", "[8,()=>'-3276.8','-1']"],
  ["the synthetic recording generator", "put(192,'EDF+C',44)"],
  ["wasm bytes in code", "new Uint8Array([0,97,115,109,1,0,0,0,1,4])"],
  ["wasm bytes in code", "new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])"],
  ["wasm bytes in code", "WebAssembly.compile(Uint8Array.from('\\0asm\\x01\\0\\0\\0',c=>c.charCodeAt(0)))"],
  ["wasm bytes in code", "fetch('data:application/wasm;base64,AGFzbQEAAAABBAFgAAA=')"],
])("%s is found", (label, code) => {
  writeFileSync(join(dir, "assets", "worker.js"), code);
  expect(findLeaks(dir)).toEqual([expect.stringContaining(label)]);
});

test("wasm_bytes_outside_the_wasm_asset_are_found", () => {
  writeFileSync(join(dir, "assets", "other.bin"), Buffer.from([9, ...MAGIC]));
  expect(findLeaks(dir)).toEqual([expect.stringContaining("wasm bytes outside a .wasm asset")]);
});

test("a_wasm_asset_must_be_a_module", () => {
  writeFileSync(join(dir, "assets", "engine.wasm"), "<html>not found</html>");
  expect(findLeaks(dir)).toEqual([expect.stringContaining("not a wasm module")]);
});
