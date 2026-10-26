import { expect, test } from "vitest";
import { classifyFolder, type FolderRecording, folderTree, ROOT } from "./folder";

/** A file at `path` (as a folder pick reports it) holding `text`. */
function file(path: string, text = "x"): File {
  const f = new File([text], path.split("/").at(-1) ?? path);
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}
const header = (data: string, marker?: string) =>
  ["Brain Vision Data Exchange Header File Version 1.0", "; DataFile=commented.eeg", "[Common Infos]"]
    .concat(
      `DataFile=${data}`,
      marker ? [`MarkerFile=${marker}`] : [],
      "[Binary Infos]",
      "DataFile=not-this.eeg",
    )
    .join("\r\n");
const summary = (recordings: FolderRecording[]) =>
  recordings.map(({ path, name, format, files, missing }) => ({
    path,
    name,
    format,
    files: files.map((f) => f.name),
    ...(missing ? { missing } : {}),
  }));

test("brainvision_triplets", async () => {
  const found = await classifyFolder([
    file("study/a.vhdr", header("a.eeg", "a.vmrk")),
    file("study/a.eeg"),
    file("study/a.vmrk"),
    // The header names its data file; a .dat it names is its companion, no text recording.
    file("study/b.vhdr", header("C:\\export\\b_data.dat")),
    file("study/b_data.dat"),
  ]);
  expect(summary(found)).toEqual([
    { path: "study/a.vhdr", name: "a", format: "BrainVision", files: ["a.vhdr", "a.eeg", "a.vmrk"] },
    { path: "study/b.vhdr", name: "b", format: "BrainVision", files: ["b.vhdr", "b_data.dat"] },
  ]);
});

test("bids_dataset_with_sidecars", async () => {
  const ieeg = "data/ds/sub-01/ses-1/ieeg";
  const stem = `${ieeg}/sub-01_ses-1_task-rest_run-01`;
  const found = await classifyFolder([
    file("data/ds/dataset_description.json"),
    file("data/ds/participants.tsv"),
    file("data/ds/sub-01/sub-01_sessions.tsv"),
    file("data/ds/sub-01/ses-1/sub-01_ses-1_scans.tsv"),
    file(`${stem}_ieeg.edf`, "12345"),
    file(`${stem}_ieeg.json`),
    file(`${stem}_channels.tsv`),
    file(`${stem}_events.tsv`),
    file(`${ieeg}/sub-01_ses-1_space-ACPC_electrodes.tsv`),
    // Delimited text inside a dataset is a table, never a recording.
    file(`${ieeg}/sub-01_ses-1_task-rest_physio.tsv`),
    file(`${ieeg}/notes.txt`),
  ]);
  expect(summary(found)).toEqual([
    {
      path: `${stem}_ieeg.edf`,
      name: "task-rest run-01",
      format: "EDF",
      files: [
        "sub-01_ses-1_task-rest_run-01_ieeg.edf",
        "sub-01_ses-1_task-rest_run-01_channels.tsv",
        "sub-01_ses-1_task-rest_run-01_events.tsv",
        "sub-01_ses-1_task-rest_run-01_ieeg.json",
      ],
    },
  ]);
  expect(found[0].size).toBe(8);
});

test("header_with_missing_data_file", async () => {
  const found = await classifyFolder([
    file("x/sub-01_ieeg.vhdr", header("sub-01_ieeg.eeg", "sub-01_ieeg.vmrk")),
    file("x/sub-01_ieeg.vmrk"),
    file("x/empty.vhdr", "[Common Infos]\nMarkerFile=empty.vmrk"),
  ]);
  expect(summary(found)).toEqual([
    {
      path: "x/empty.vhdr",
      name: "empty",
      format: "BrainVision",
      files: ["empty.vhdr"],
      missing: "The header names no data file",
    },
    {
      path: "x/sub-01_ieeg.vhdr",
      name: "sub-01_ieeg",
      format: "BrainVision",
      files: ["sub-01_ieeg.vhdr", "sub-01_ieeg.vmrk"],
      missing: "Missing data file sub-01_ieeg.eeg",
    },
  ]);
});

test("hidden_folders_and_node_modules_are_skipped", async () => {
  const found = await classifyFolder([
    file("p/.git/a.edf"),
    file("p/node_modules/pkg/b.edf"),
    file("p/sub/.cache/c.bdf"),
    file("p/sub/.d.edf"),
    file("p/sub/e.bdf"),
  ]);
  expect(found.map((r) => r.path)).toEqual(["p/sub/e.bdf"]);
});

test("delimited_text_outside_bids", async () => {
  const found = await classifyFolder([
    file("lab/run 2.csv"),
    file("lab/run 10.dat"),
    file("lab/readme.md"),
    file("lab/plot.png"),
    file("lab/ds/dataset_description.json"),
    file("lab/ds/sub-01/eeg/sub-01_task-x_eeg.edf"),
    file("lab/ds/sub-01/eeg/table.csv"),
  ]);
  expect(found.map(({ path, name, format }) => ({ path, name, format }))).toEqual([
    { path: "lab/ds/sub-01/eeg/sub-01_task-x_eeg.edf", name: "task-x", format: "EDF" },
    { path: "lab/run 2.csv", name: "run 2", format: "Text" },
    { path: "lab/run 10.dat", name: "run 10", format: "Text" },
  ]);
});

test("participants_and_bids_tables_are_never_recordings", async () => {
  // Outside a dataset too: the names alone mark them.
  const found = await classifyFolder([
    file("study/participants.tsv"),
    file("study/a_events.tsv"),
    file("study/a_channels.tsv"),
    file("study/sub-01_scans.tsv"),
    file("study/b.tsv"),
  ]);
  expect(found.map((r) => r.path)).toEqual(["study/b.tsv"]);
});

const recording = (path: string): FolderRecording => ({
  path,
  name: path.split("/").at(-1) as string,
  format: "EDF",
  size: 0,
  files: [],
});

test("tree_collapses_single_child_chains", () => {
  const vhdr = "data/ds003029/sub-pt01/ses-presurgery/ieeg/run.vhdr";
  const { root, nodes, expanded } = folderTree([recording(vhdr), recording("data/top.edf")], false);
  expect(root).toBe("data");
  const chain = "data/ds003029/sub-pt01/ses-presurgery/ieeg/";
  expect(nodes[ROOT].children).toEqual([chain, "data/top.edf"]);
  expect(nodes[chain]).toMatchObject({ label: "ds003029 / sub-pt01 / ses-presurgery / ieeg", count: 1 });
  expect(nodes[chain].children).toEqual([vhdr]);
  expect(Object.keys(nodes)).toHaveLength(4);
  expect(expanded).toEqual([chain]);
});

test("tree_of_more_than_40_rows_expands_its_first_level", () => {
  const paths = Array.from({ length: 30 }, (_, i) => `d/sub-${i + 1}/eeg/run-${(i % 2) + 1}.edf`);
  const many = folderTree([...paths, "d/sub-1/eeg/run-9.edf", "d/a.edf"].map(recording), false);
  // Each subject is one row (sub-N / eeg); the rows sort by number, folders before recordings.
  expect(many.nodes[ROOT].children.slice(0, 3)).toEqual(["d/sub-1/eeg/", "d/sub-2/eeg/", "d/sub-3/eeg/"]);
  expect(many.nodes[ROOT].children.at(-1)).toBe("d/a.edf");
  expect(many.nodes["d/sub-1/eeg/"].children).toEqual(["d/sub-1/eeg/run-1.edf", "d/sub-1/eeg/run-9.edf"]);
  // 30 folders and 32 recordings: past 40 rows, only the top level is expanded, which here is every folder.
  expect(many.expanded).toHaveLength(30);
  const deep = Array.from({ length: 50 }, (_, i) => recording(`d/ds/sub-${i}/eeg/a.edf`));
  deep.push(recording("d/x/a.edf"));
  expect(folderTree(deep, false).expanded).toEqual(["d/ds/", "d/x/"]);
  // A filter expands every folder: ds, x and the 50 subject chains.
  expect(folderTree(deep, true).expanded).toHaveLength(52);
});
