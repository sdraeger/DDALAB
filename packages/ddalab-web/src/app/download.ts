// Saving a file the page made, for the result and annotation exports: through the browser's own Save dialog where it
// has one (Chromium), else through its downloads.

/** What an export makes: a Blob (kept on disk by the browser when it is large) or a stream of its bytes. */
export type Saveable = Blob | ReadableStream<Uint8Array>;

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/** What the dialog offers for the extensions of the exports: a description and the MIME type. */
const FORMATS: Record<string, { description: string; type: string }> = {
  zip: { description: "Result bundle", type: "application/zip" },
  json: { description: "JSON", type: "application/json" },
  csv: { description: "CSV", type: "text/csv" },
  tsv: { description: "Tab-separated values", type: "text/tab-separated-values" },
};

/**
 * Saves what `make` returns as `name`. Where the browser has a Save dialog, it opens first, before the file is made: it
 * needs the click that asked for it, which a long export outlasts, and a dialog closed unanswered ends the call with
 * nothing made, written or reported. The bytes then stream into the chosen file as they are made. Without a dialog, or
 * when the browser refuses it, the file goes to the downloads as a Blob.
 */
export async function download(name: string, make: () => Saveable | Promise<Saveable>) {
  const pick = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  let target: FileSystemFileHandle | undefined;
  if (pick) {
    const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const format = FORMATS[extension];
    try {
      target = await pick({
        suggestedName: name,
        types: format
          ? [{ description: format.description, accept: { [format.type]: [`.${extension}`] } }]
          : [],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const data = await make();
  if (target) {
    await (data instanceof Blob ? data.stream() : data).pipeTo(await target.createWritable());
    return;
  }
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(data instanceof Blob ? data : await new Response(data).blob()),
    download: name,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
