/**
 * Compiles the engine module at `url`. Streaming compilation needs the server to send `application/wasm`; a
 * static host that does not (a userdir Apache without the .htaccess, say) gets the bytes compiled instead.
 */
export async function compileWasm(url: string): Promise<WebAssembly.Module> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`The engine module could not be loaded: ${url} answered ${response.status}`);
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type === "application/wasm" && typeof WebAssembly.compileStreaming === "function")
    return WebAssembly.compileStreaming(response);
  return WebAssembly.compile(await response.arrayBuffer());
}
