import { afterEach, expect, test, vi } from "vitest";
import { buildFileSet, type FileSet, isScanned, readUrlSync } from "./sources";

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
  expect(set("a.csv", "e.fdt", "e.set", "c.edf")).toMatchObject({ primary: "e.set" });
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
  const FORMATS = "DDALAB reads EDF, BDF, BrainVision, EEGLAB and delimited text";
  expect(buildFileSet(files("scan.fif"))).toEqual({ error: `FIFF files are not supported yet; ${FORMATS}` });
  expect(buildFileSet(files("notes.pdf"))).toEqual({
    error: `notes.pdf is not a format DDALAB reads; ${FORMATS}`,
  });
  expect(buildFileSet([])).toEqual({ error: "No file was chosen" });
});

test("remote_files_above_1_gib_are_not_scanned", () => {
  const url = (...sizes: number[]) => ({
    kind: "url" as const,
    primary: "a.vhdr",
    files: sizes.map((size, i) => ({ name: `a${i}`, url: `https://example.org/a${i}`, size })),
  });
  expect(isScanned(url(2 ** 30))).toBe(true);
  expect(isScanned(url(2 ** 30, 1))).toBe(false);
  expect(isScanned({ kind: "files", files: [], primary: "a.edf" })).toBe(true);
});

/** Answers every synchronous GET with `status` and `body`, as a server would to a ranged request. */
function answer(status: number, body: Uint8Array) {
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      status = status;
      response = body.buffer;
      open() {}
      setRequestHeader() {}
      send() {}
    },
  );
}
afterEach(() => vi.unstubAllGlobals());
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);
const SIDECAR = "https://openneuro.org/crn/datasets/ds003029/objects/9f94?filename=run-01_events.tsv";

test("url_read_takes_a_small_file_sent_whole", () => {
  // OpenNeuro's object store ignores Range and sends a sidecar whole.
  answer(200, bytes(885));
  const dst = new Uint8Array(5);
  readUrlSync(SIDECAR, 885, 10, dst);
  expect(Array.from(dst)).toEqual([10, 11, 12, 13, 14]);
});

test("url_read_refuses_a_data_file_sent_whole", () => {
  answer(200, bytes(16));
  const eeg = "https://openneuro.org/crn/datasets/ds003029/objects/a1b2?filename=run-01_ieeg.eeg";
  expect(() => readUrlSync(eeg, 105479360, 0, new Uint8Array(4))).toThrow(
    `openneuro.org ignores Range requests: ${eeg} is above 4 MiB and would download whole at every read`,
  );
});

test("url_read_refuses_a_whole_answer_of_another_size", () => {
  // A portal or proxy page in place of the file.
  answer(200, bytes(3000));
  expect(() => readUrlSync(SIDECAR, 885, 0, new Uint8Array(4))).toThrow(
    `${SIDECAR}: asked for 4 bytes at 0, got status 200 with 3000 bytes`,
  );
});

test("url_read_takes_a_range", () => {
  answer(206, bytes(4));
  const dst = new Uint8Array(4);
  readUrlSync("https://s3.amazonaws.com/openneuro.org/ds003029/run-01_ieeg.eeg", 105479360, 4096, dst);
  expect(Array.from(dst)).toEqual([0, 1, 2, 3]);
});
