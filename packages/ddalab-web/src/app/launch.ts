// Files the operating system opens the installed app with ("Open with" in Finder or Explorer; the File Handling API of
// Chromium, announced by `file_handlers` in public/manifest.webmanifest). Other browsers have no launch queue and
// never call it.
import { useStore } from "../store/store";
import { beside, permitted } from "./handles";
import type { FileHandles, Outcome, openFiles } from "./recordings";

/** What a launch brings: the handles of the files that were opened with the app. */
export interface LaunchParams {
  files: FileSystemHandle[];
}
export interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** The browser's launch queue, where it has one. */
export const launchQueue = () => (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;

/** Hands the files of every launch, now and later, to `open`. A launch without a file is ignored. */
export function consumeLaunches(
  queue: LaunchQueue | undefined,
  open: (handles: FileSystemFileHandle[]) => void,
) {
  queue?.setConsumer((params) => {
    const files = params.files.filter((handle): handle is FileSystemFileHandle => handle.kind === "file");
    if (files.length > 0) open(files);
  });
}

/** The files of one attempt to open, as LibraryRail keeps them for a choice among several recordings. */
export interface Attempt {
  files: File[];
  handle?: FileSystemHandle;
  handles: FileHandles;
}

/**
 * Opens the launched `handles` as a picked file opens: their handles go to the tab and the recording reattaches on the
 * next visit. A header that arrives without its companions (a .vhdr alone) is looked for in the folders the app may
 * read already, `roots`: the first that holds the file gives its folder's files. With none, the outcome is the core's
 * message, which offers to choose the folder.
 */
export async function openLaunched(
  handles: FileSystemFileHandle[],
  deps: { open: typeof openFiles; roots(): Promise<FileSystemDirectoryHandle[]> },
): Promise<{ attempt: Attempt; outcome: Outcome }> {
  const attempt: Attempt = {
    files: await Promise.all(handles.map((handle) => handle.getFile())),
    handle: handles.length === 1 ? handles[0] : undefined,
    handles: { files: handles },
  };
  const outcome = await deps.open(attempt.files, attempt);
  if (outcome.kind !== "error" || !outcome.folder) return { attempt, outcome };
  for (const root of await deps.roots()) {
    const found = await beside(root, handles[0]).catch(() => undefined);
    if (!found) continue;
    const next: Attempt = { files: found.files, handles: found.handles };
    return { attempt: next, outcome: await deps.open(found.files, { ...next, choice: found.choice }) };
  }
  return { attempt, outcome };
}

/** The folders of the open tabs that the browser lets the app read now, without asking. */
export async function grantedRoots(): Promise<FileSystemDirectoryHandle[]> {
  const roots = useStore
    .getState()
    .tabs.flatMap((tab) => (tab.source?.kind === "files" && tab.source.root ? [tab.source.root] : []));
  const granted = await Promise.all(
    [...new Set(roots)].map(async (root) => ((await permitted(root)) ? [root] : [])),
  );
  return granted.flat();
}
