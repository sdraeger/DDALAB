// Saving a file the page made, for the result and annotation exports.

/** Saves `blob` as `name` through the browser's downloads. */
export function download(blob: Blob, name: string) {
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: name,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

type SavePicker = (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;

/**
 * Saves the stream `make` returns as `name`, a part at a time: into the file the native Save dialog picks (Chromium),
 * else into a file of the origin's private storage that then downloads. False when the user closed the dialog. Call
 * it first thing in a click: the dialog opens only while the click's activation lasts.
 */
export async function saveStream(name: string, make: () => Promise<ReadableStream<Uint8Array>>) {
  const pick = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (pick) {
    const handle = await pick({ suggestedName: name }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    });
    if (!handle) return false;
    await (await make()).pipeTo(await handle.createWritable());
    return true;
  }
  const spool = await navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle("exports", { create: true }))
    .catch(() => undefined);
  if (!spool || !("createWritable" in FileSystemFileHandle.prototype)) {
    // shortcut: without a writable file in OPFS the zip becomes one Blob, which browsers keep on disk when it is
    // large; upgrade when a browser without both needs exports of many GB.
    download(await new Response(await make()).blob(), name);
    return true;
  }
  // shortcut: the last export's file goes when the next one starts, long after its download; a download still running
  // then fails. Upgrade to a file per export if that happens.
  for await (const old of spool.keys()) await spool.removeEntry(old);
  const file = await spool.getFileHandle(name, { create: true });
  await (await make()).pipeTo(await file.createWritable());
  download(await file.getFile(), name);
  return true;
}
