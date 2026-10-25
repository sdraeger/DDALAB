// For tests in Node: the parts of the origin private file system that result storage, exports and imports use, in
// memory. `memoryOpfs()` puts a fresh root behind `navigator.storage.getDirectory`, and Web Locks for one context
// behind `navigator.locks`, and returns the root.
import { vi } from "vitest";

export type Tree = Map<string, Tree | { bytes: Uint8Array }>;

function handle(tree: Tree): FileSystemDirectoryHandle {
  const missing = () => new DOMException("not found", "NotFoundError");
  const file = (name: string, data: { bytes: Uint8Array }) => ({
    kind: "file",
    name,
    getFile: async () => new File([data.bytes.slice()], name),
    async createSyncAccessHandle() {
      return {
        truncate(size: number) {
          const bytes = new Uint8Array(size);
          bytes.set(data.bytes.subarray(0, size));
          data.bytes = bytes;
        },
        write(source: Uint8Array, { at }: { at: number }) {
          if (at + source.length > data.bytes.length) this.truncate(at + source.length);
          data.bytes.set(source, at);
          return source.length;
        },
        flush() {},
        close() {},
      };
    },
  });
  return {
    kind: "directory",
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      if (!tree.has(name) && options?.create) tree.set(name, new Map());
      const found = tree.get(name);
      if (!(found instanceof Map)) throw missing();
      return handle(found);
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!tree.has(name) && options?.create) tree.set(name, { bytes: new Uint8Array() });
      const found = tree.get(name);
      if (!found || found instanceof Map) throw missing();
      return file(name, found);
    },
    async removeEntry(name: string) {
      if (!tree.delete(name)) throw missing();
    },
    async *entries() {
      for (const [name, entry] of tree)
        yield [name, entry instanceof Map ? handle(entry) : file(name, entry)];
    },
  } as unknown as FileSystemDirectoryHandle;
}

/** Web Locks for one context: the holders of a name run one after another, shared ones too. */
function memoryLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request(name: string, ...rest: unknown[]) {
      const callback = rest.pop() as (lock: { name: string } | null) => unknown;
      if ((rest[0] as { ifAvailable?: boolean } | undefined)?.ifAvailable && tails.has(name))
        return Promise.resolve().then(() => callback(null));
      const held = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name }));
      const tail = held.then(
        () => {},
        () => {},
      );
      tails.set(name, tail);
      void tail.then(() => tails.get(name) === tail && tails.delete(name));
      return held;
    },
  };
}

export function memoryOpfs(): Tree {
  const root: Tree = new Map();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => handle(root) }, locks: memoryLocks() });
  return root;
}

/** Puts `bytes` at `path` under `tree`, making its folders. */
export function putFile(tree: Tree, path: string, bytes: Uint8Array | string) {
  const names = path.split("/");
  let folder = tree;
  for (const name of names.slice(0, -1)) {
    if (!folder.has(name)) folder.set(name, new Map());
    folder = folder.get(name) as Tree;
  }
  folder.set(names[names.length - 1], {
    bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
  });
}
