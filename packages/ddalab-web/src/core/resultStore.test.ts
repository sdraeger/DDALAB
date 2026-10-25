// The startup sweep of unfinished results, against a stand-in for OPFS and the Web Locks API.
import { afterEach, expect, test, vi } from "vitest";
import { sweepInterrupted } from "./resultStore";

/** A result directory whose `status` file holds `status`. */
const result = (status: string) => ({
  kind: "directory" as const,
  getFileHandle: async () => ({ getFile: async () => ({ text: async () => status }) }),
});

afterEach(() => vi.unstubAllGlobals());

test("a_result_that_cannot_be_removed_leaves_the_others_swept", async () => {
  const entries = { a: result("running"), b: result("running"), c: result("complete"), d: result("running") };
  const removed: string[] = [];
  const results = {
    entries: async function* () {
      yield* Object.entries(entries);
    },
    removeEntry: async (id: string) => {
      if (id === "b") throw new DOMException("A file is in use", "NoModificationAllowedError");
      removed.push(id);
    },
  };
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => ({ getDirectoryHandle: async () => results }) },
    locks: {
      request: (_name: string, _options: unknown, held: (lock: object) => Promise<void>) => held({}),
    },
  });
  expect(await sweepInterrupted()).toEqual(["a", "d"]);
  expect(removed).toEqual(["a", "d"]);
});
