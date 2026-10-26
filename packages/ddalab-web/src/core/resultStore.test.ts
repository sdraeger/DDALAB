// The startup sweep of unfinished results and the deletion of a result, against stand-ins for OPFS and the Web Locks
// API.
import { afterEach, expect, test, vi } from "vitest";
import { memoryOpfs, putFile, type Tree } from "./memoryOpfs";
import { npyHeader } from "./npy";
import { deleteResult, resultArray, resultsDirectory, sweepInterrupted } from "./resultStore";

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

test("a_window_without_opfs_says_so", async () => {
  const unknown = new DOMException("The operation failed for an unknown transient reason", "UnknownError");
  vi.stubGlobal("navigator", { storage: { getDirectory: () => Promise.reject(unknown) } });
  await expect(resultsDirectory()).rejects.toThrow("Browser storage is not available in this window");
});

test("delete_waits_for_a_pyramid_build_then_removes_its_files", async () => {
  const root = memoryOpfs();
  // 20 windows of 2 rows: pyramid levels 1 to 3 above the array (4 windows a cell per level).
  const header = npyHeader([20, 2]);
  const array = new Uint8Array(header.length + 8 * 20 * 2);
  array.set(header);
  putFile(root, "results/r/ST/q.npy", array);
  const folder = () => (root.get("results") as Tree).get("r") as Tree | undefined;
  // The build of the array's pyramid holds its locks until `open` is called.
  const events: string[] = [];
  let entered = () => {};
  const inBuild = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const request = navigator.locks.request as (...args: unknown[]) => Promise<unknown>;
  const locks = {
    request(name: string, ...rest: unknown[]) {
      const held = rest.pop() as (lock: unknown) => Promise<unknown>;
      if (name !== "ddalab-pyramid:r/ST/q") return request(name, ...rest, held);
      return request(name, ...rest, async (lock: unknown) => {
        entered();
        await gate;
        const out = await held(lock);
        events.push(`built ${[...((folder()?.get("ST") as Tree) ?? []).keys()].sort().join(" ")}`);
        return out;
      });
    },
  };
  vi.stubGlobal("navigator", { ...navigator, locks });
  const building = resultArray("r", "ST", "q").catch(() => {});
  await inBuild;
  const deleting = deleteResult("r").then(() => events.push("deleted"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(events).toEqual([]);
  expect(folder()).toBeDefined();
  open();
  await deleting;
  await building;
  expect(events).toEqual(["built q.L1.f32 q.L2.f32 q.L3.f32 q.npy q.pyramid.json", "deleted"]);
  expect(folder()).toBeUndefined();
});
