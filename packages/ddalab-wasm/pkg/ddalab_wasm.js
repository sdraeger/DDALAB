/**
 * Checked-in fallback entrypoint for the DDALAB WASM package.
 *
 * A real `wasm-pack build` will overwrite this file with the generated wrapper.
 * Until then, the app can import this module and intentionally fall back to the
 * JS implementations without emitting module resolution warnings in Next dev.
 */

export const __wasm_stub = true;

export default async function init() {
  return undefined;
}
