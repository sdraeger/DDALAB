// File System Access handles (Chromium): a folder picked with its handle, files read again through a folder handle,
// and read permission. TypeScript's DOM library declares none of these.
type Permissions = {
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
};
type Folder = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

const folderPicker = () =>
  (window as { showDirectoryPicker?: (options: { mode: "read" }) => Promise<Folder> }).showDirectoryPicker;

/** Whether the browser has its own folder picker, which gives a handle (Chromium). */
export const canPickFolder = () => folderPicker() !== undefined;

/** Each file under `folder` with its handle; its path from the folder's parent is its `webkitRelativePath`. */
async function filesUnder(folder: Folder, prefix: string, out: Map<File, FileSystemFileHandle>) {
  for await (const handle of folder.values()) {
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      Object.defineProperty(file, "webkitRelativePath", { value: prefix + file.name });
      out.set(file, handle as FileSystemFileHandle);
    } else await filesUnder(handle as Folder, `${prefix}${handle.name}/`, out);
  }
}

/**
 * The files of a folder the user picks in the browser's own picker, with the folder's handle and each file's;
 * `undefined` without the picker. Rejects when the user closes it.
 */
export async function pickFolder() {
  const show = folderPicker();
  if (!show) return undefined;
  const root = await show({ mode: "read" });
  const files = new Map<File, FileSystemFileHandle>();
  await filesUnder(root, `${root.name}/`, files);
  return { files: [...files.keys()], handles: { files, root } };
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
