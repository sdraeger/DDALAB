import { afterEach, expect, test, vi } from "vitest";
import { compileWasm } from "./compileWasm";

/** The smallest valid module: the magic number and version 1. */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

const serve = (init: ResponseInit) => vi.stubGlobal("fetch", async () => new Response(EMPTY_MODULE, init));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("wasm_mime_type_compiles_streaming", async () => {
  const streaming = vi.spyOn(WebAssembly, "compileStreaming");
  serve({ headers: { "content-type": "application/wasm" } });
  expect(await compileWasm("engine.wasm")).toBeInstanceOf(WebAssembly.Module);
  expect(streaming).toHaveBeenCalledOnce();
});

test.each([
  ["application/octet-stream", { "content-type": "application/octet-stream" }],
  ["text/html", { "content-type": "text/html; charset=utf-8" }],
  ["no content type", {}],
])("wrong_mime_type_falls_back_to_bytes (%s)", async (_, headers) => {
  const streaming = vi.spyOn(WebAssembly, "compileStreaming");
  serve({ headers });
  expect(await compileWasm("engine.wasm")).toBeInstanceOf(WebAssembly.Module);
  expect(streaming).not.toHaveBeenCalled();
});

test("missing_module_names_the_url_and_status", async () => {
  serve({ status: 404, headers: { "content-type": "text/html" } });
  await expect(compileWasm("assets/engine.wasm")).rejects.toThrow("assets/engine.wasm answered 404");
});

test("bytes_that_are_no_module_reject", async () => {
  vi.stubGlobal(
    "fetch",
    async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
  );
  await expect(compileWasm("engine.wasm")).rejects.toBeInstanceOf(WebAssembly.CompileError);
});
