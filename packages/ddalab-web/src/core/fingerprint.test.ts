import { expect, test } from "vitest";
import { fingerprint, fingerprintOf } from "./fingerprint";

const EDGE = 64 * 1024;
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

test("stable_and_size_sensitive", async () => {
  const data = bytes(300 * 1024, 7);
  const base = await fingerprint(new Blob([data]), "a.edf");
  expect(base).toMatch(/^[0-9a-f]{64}$/);
  expect(await fingerprint(new Blob([data]), "a.edf")).toBe(base);
  // One more byte, another name and a change in the first or last 64 KiB all change it.
  expect(await fingerprint(new Blob([data, bytes(1, 7)]), "a.edf")).not.toBe(base);
  expect(await fingerprint(new Blob([data]), "b.edf")).not.toBe(base);
  for (const at of [0, EDGE - 1, data.length - EDGE, data.length - 1]) {
    const edited = data.slice();
    edited[at] = 8;
    expect(await fingerprint(new Blob([edited]), "a.edf")).not.toBe(base);
  }
  // shortcut: the middle of a file is not hashed; an edit there keeps the fingerprint
  const middle = data.slice();
  middle[data.length / 2] = 8;
  expect(await fingerprint(new Blob([middle]), "a.edf")).toBe(base);
});

test("blob_and_ranges_agree", async () => {
  const data = Uint8Array.from({ length: 200 * 1024 }, (_, i) => i % 251);
  const blob = await fingerprint(new Blob([data]), "a.edf");
  const ranges = (bytes: Uint8Array) => (a: number, b: number) => bytes.slice(a, b);
  expect(await fingerprintOf("a.edf", data.length, ranges(data))).toBe(blob);
  // A file shorter than 64 KiB is its own head and tail.
  const small = data.slice(0, 1000);
  expect(await fingerprintOf("s.edf", 1000, ranges(small))).toBe(
    await fingerprint(new Blob([small]), "s.edf"),
  );
});
