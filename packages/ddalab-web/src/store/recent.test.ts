import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { forgetRecent, listRecent, rememberRecent } from "./recent";

// A stand-in for a FileSystemFileHandle: plain data survives IndexedDB's structured clone.
const handle = { kind: "file", name: "a.edf" } as unknown as FileSystemHandle;
const entry = (fingerprint: string, extra = {}) => ({
  fingerprint,
  primary: `${fingerprint}.edf`,
  names: [`${fingerprint}.edf`],
  ...extra,
});

beforeEach(async () => {
  for (const { fingerprint } of await listRecent()) await forgetRecent(fingerprint);
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "showOpenFilePicker");
});

test("handle_kept_where_the_picker_exists", async () => {
  Object.assign(globalThis, { showOpenFilePicker: () => {} });
  await rememberRecent(entry("a", { handle }));
  const [kept] = await listRecent();
  expect(kept).toMatchObject({ fingerprint: "a", primary: "a.edf", names: ["a.edf"], handle });
});

test("handle_dropped_without_the_picker", async () => {
  await rememberRecent(entry("a", { handle }));
  const [kept] = await listRecent();
  expect(kept.fingerprint).toBe("a");
  expect(kept.handle).toBeUndefined();
});

test("newest_first_one_entry_per_fingerprint_capped", async () => {
  for (let i = 0; i < 25; i++) await rememberRecent(entry(`f${i}`), 1000 + i);
  await rememberRecent(entry("f10"), 2000);
  const list = await listRecent();
  expect(list).toHaveLength(20);
  expect(list[0]).toMatchObject({ fingerprint: "f10", lastOpened: 2000 });
  // The 20 newest are f5 to f24; f10 moved to the front.
  const rest = Array.from({ length: 20 }, (_, i) => `f${24 - i}`).filter((f) => f !== "f10");
  expect(list.slice(1).map((e) => e.fingerprint)).toEqual(rest);
});

test("one_connection_serves_every_call", async () => {
  await listRecent();
  const open = vi.spyOn(indexedDB, "open");
  await rememberRecent(entry("a"));
  await rememberRecent(entry("b"));
  await listRecent();
  await forgetRecent("a");
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});

// Another tab running newer code raises the database version. Our open connection must not hold that up.
test("a_version_upgrade_in_another_tab_is_not_blocked", async () => {
  await listRecent();
  const upgraded = openDB("ddalab", 7, { upgrade: (db) => void db.createObjectStore("later") });
  const timeout = new Promise<string>((done) => setTimeout(() => done("blocked"), 1000));
  const outcome = await Promise.race([upgraded.then(() => "upgraded"), timeout]);
  expect(outcome).toBe("upgraded");
  // The old code cannot open version 6 any more; it fails instead of hanging.
  await expect(listRecent()).rejects.toThrow();
});
