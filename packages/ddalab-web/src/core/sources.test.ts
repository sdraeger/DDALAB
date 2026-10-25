import { expect, test } from "vitest";
import { buildFileSet, type FileSet } from "./sources";

/** A file; `path` is what `<input webkitdirectory>` reports as `webkitRelativePath`. */
function file(path: string): File {
  const f = new File(["x"], path.split("/").at(-1) ?? path);
  if (path.includes("/")) Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}
const files = (...paths: string[]) => paths.map(file);
const names = (set: FileSet) => ("files" in set ? set.files.map((f) => f.name) : undefined);

test("primary_preference", () => {
  const set = (...paths: string[]) => buildFileSet(files(...paths));
  expect(set("a.csv", "b.eeg", "b.vhdr", "b.vmrk", "c.edf", "d.bdf")).toMatchObject({ primary: "b.vhdr" });
  expect(set("a.csv", "c.edf", "d.bdf")).toMatchObject({ primary: "c.edf" });
  expect(set("a.csv", "d.bdf")).toMatchObject({ primary: "d.bdf" });
  expect(set("a.CSV")).toMatchObject({ primary: "a.CSV" });
  expect(set("a.tsv", "a.json")).toMatchObject({ primary: "a.tsv" });
});

test("whole_directory_passed", () => {
  const set = buildFileSet(
    files(
      "study/sub-01/ieeg/x.vhdr",
      "study/sub-01/ieeg/x.eeg",
      "study/sub-01/ieeg/x.vmrk",
      "study/sub-01/ieeg/x_channels.tsv",
      "study/sub-01/notes.txt",
      "study/sub-02/ieeg/y.edf",
    ),
  );
  // The primary is the best format; the set is its directory and nothing from other directories.
  expect(set).toMatchObject({ primary: "x.vhdr" });
  expect(names(set)).toEqual(["x.vhdr", "x.eeg", "x.vmrk", "x_channels.tsv"]);
});

test("several_primaries_ask", () => {
  const all = files("study/sub-01/a.edf", "study/sub-01/a_events.tsv", "study/sub-02/b.edf");
  const asked = buildFileSet(all);
  expect(asked).toEqual({ candidates: ["study/sub-01/a.edf", "study/sub-02/b.edf"] });
  const chosen = buildFileSet(all, "study/sub-02/b.edf");
  expect(chosen).toMatchObject({ primary: "b.edf" });
  expect(names(chosen)).toEqual(["b.edf"]);
  expect(buildFileSet(all, "study/sub-03/c.edf")).toEqual({
    error: "study/sub-03/c.edf is not among the files",
  });
});

test("unsupported_formats_say_why", () => {
  const FORMATS = "DDALAB reads EDF, BDF, BrainVision and delimited text";
  expect(buildFileSet(files("scan.fif"))).toEqual({ error: `FIFF files are not supported yet; ${FORMATS}` });
  expect(buildFileSet(files("scan.set", "scan.fdt"))).toEqual({
    error: `EEGLAB files are not supported yet; ${FORMATS}`,
  });
  expect(buildFileSet(files("notes.pdf"))).toEqual({
    error: `notes.pdf is not a format DDALAB reads; ${FORMATS}`,
  });
  expect(buildFileSet([])).toEqual({ error: "No file was chosen" });
});
