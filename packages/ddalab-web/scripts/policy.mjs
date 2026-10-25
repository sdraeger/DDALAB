// The header policy of public/.htaccess, as the smoke test server and the live check read it.

/** Cache-Control of the hashed scripts, style sheets and wasm module. */
export const IMMUTABLE = "public, max-age=31536000, immutable";
/** Cache-Control of index.html, the one file whose name carries no hash. */
export const NO_CACHE = "no-cache";

/** The Content-Security-Policy that an .htaccess text sets, with its line continuations folded to single spaces. */
export function cspOf(htaccess) {
  const set = /Header\s+(?:always\s+)?set\s+Content-Security-Policy\s+"([^"]*)"/i.exec(htaccess);
  if (!set) throw new Error("the .htaccess sets no Content-Security-Policy");
  return set[1]
    .replace(/\\\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
