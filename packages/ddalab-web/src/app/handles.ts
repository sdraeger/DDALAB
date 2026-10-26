// File System Access handles (Chromium): a folder picked with its handle, files read again through a folder handle,
// and read permission. TypeScript's DOM library declares the permission calls nowhere.
import type { FileHandles } from "./recordings";

type Permissions = {
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
};

const folderPicker = () =>
  (window as { showDirectoryPicker?: (options: { mode: "read" }) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;

/** Whether the browser has its own folder picker, which gives a handle (Chromium). */
export const canPickFolder = () => folderPicker() !== undefined;

/**
 * The files of a folder the user picks in the browser's own picker, walked as the folder tree walks one, with their
 * handles in the same order and the folder's; `undefined` without the picker. Rejects when the user closes it.
 */
export async function pickFolder(): Promise<{ files: File[]; handles: FileHandles } | undefined> {
  const show = folderPicker();
  if (!show) return undefined;
  const handle = await show({ mode: "read" });
  // Loaded with the walk, which the folder tree's chunk holds too.
  const { walk } = await import("../core/folder");
  const walked = await walk({ kind: "handle", handle }, new AbortController().signal, () => {});
  const files = walked.files.filter((file) => walked.handles.has(file));
  const own = files.map((file) => walked.handles.get(file) as FileSystemFileHandle);
  return { files, handles: { files: own, root: walked.root } };
}

/** The file at `path` (`root/sub/name`) under `root`, with that path. */
export async function fileAt(root: FileSystemDirectoryHandle, path: string): Promise<File> {
  const [, ...folders] = path.split("/");
  const name = folders.pop() as string;
  let folder = root;
  for (const sub of folders) folder = await folder.getDirectoryHandle(sub);
  const file = await (await folder.getFileHandle(name)).getFile();
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

/** Whether `handle` may be read now, without asking. */
export async function permitted(handle: FileSystemHandle): Promise<boolean> {
  const own = handle as FileSystemHandle & Partial<Permissions>;
  return (await own.queryPermission?.({ mode: "read" }).catch(() => undefined)) === "granted";
}

/**
 * Asks the user for read access to `handle`, which only a click allows: the answer, or `lapsed` when the browser
 * refused to ask because the click was too long ago.
 */
export async function ask(handle: FileSystemHandle): Promise<PermissionState | "lapsed"> {
  const own = handle as FileSystemHandle & Partial<Permissions>;
  try {
    return (await own.requestPermission?.({ mode: "read" })) ?? "denied";
  } catch (error) {
    return (error as Error).name === "SecurityError" ? "lapsed" : "denied";
  }
}
