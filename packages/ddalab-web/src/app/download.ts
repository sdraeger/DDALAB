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
