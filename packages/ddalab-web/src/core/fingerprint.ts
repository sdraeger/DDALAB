// A cheap identity for a file: it tells "the same recording again" from "another file" without reading all of it.
const EDGE = 64 * 1024;

/** SHA-256 of `parts` joined, as lowercase hex. */
export async function sha256Hex(...parts: BlobPart[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await new Blob(parts).arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex of `name`, `size` and the first and last 64 KiB; `slice(a, b)` returns the bytes `a..b` of the file. */
export const fingerprintOf = (name: string, size: number, slice: (start: number, end: number) => BlobPart) =>
  sha256Hex(`${name}\0${size}\0`, slice(0, Math.min(size, EDGE)), slice(Math.max(0, size - EDGE), size));

// shortcut: the middle of the file is not hashed (an edit there keeps the fingerprint); hash all of it if that matters.
export const fingerprint = (file: Blob, name: string) =>
  fingerprintOf(name, file.size, (a, b) => file.slice(a, b));
