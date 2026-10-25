// The OpenNeuro client against GraphQL answers recorded from https://openneuro.org/crn/graphql on 2026-10-25
// (ds003029 at 1.0.7; the search answer keeps its first three hits).
import { afterEach, expect, test, vi } from "vitest";
import { listFiles, type RemoteFile, recordingInput, searchDatasets } from "./api";
import { DEMO, parseDeepLink } from "./deepLink";
import ieeg from "./recorded/files-ieeg.json";
import session from "./recorded/files-ses-presurgery.json";
import search from "./recorded/search-epilepsy-ieeg.json";

/** Answers every request with `answer` and returns the request bodies sent. */
function answer(json: unknown) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(json)));
  vi.stubGlobal("fetch", fetch);
  return () =>
    fetch.mock.calls.map(([url, init]) => ({ url, method: init.method, ...JSON.parse(init.body as string) }));
}
afterEach(() => vi.unstubAllGlobals());

test("search_parses_hits", async () => {
  const sent = answer(search);
  const signal = new AbortController().signal;
  expect(await searchDatasets("epilepsy ieeg", signal)).toEqual([
    {
      id: "ds004100",
      name: "HUP iEEG Epilepsy Dataset",
      tag: "1.1.3",
      modalities: ["ieeg"],
      subjects: 57,
      size: 14196260504,
    },
    {
      id: "ds003029",
      name: "Epilepsy-iEEG-Multicenter-Dataset",
      tag: "1.0.7",
      modalities: ["ieeg"],
      subjects: 35,
      size: 11083752416,
    },
    {
      id: "ds003876",
      name: "Epilepsy-iEEG-Interictal-Multicenter-Dataset",
      tag: "1.0.2",
      modalities: ["ieeg"],
      subjects: 39,
      size: 5368598177,
    },
  ]);
  expect(sent()).toMatchObject([
    {
      url: "https://openneuro.org/crn/graphql",
      method: "POST",
      variables: { query: { keywords: ["epilepsy ieeg"], publicOnly: true } },
    },
  ]);
});

test("search_skips_datasets_without_a_snapshot", async () => {
  answer({ data: { advancedSearch: { edges: [null, { node: { id: "ds000001", latestSnapshot: null } }] } } });
  expect(await searchDatasets("x", new AbortController().signal)).toEqual([]);
});

test("list_files_parses_tree", async () => {
  const sent = answer(session);
  const tree = "7dcdd4f4b0470aa7da0d6b1e9b77ece81398d2c6";
  expect(await listFiles("ds003029", "1.0.7", tree)).toEqual([
    {
      id: "1e127e6f7a86868e4fc8b67134aa74190d5838bc",
      filename: "sub-pt01_ses-presurgery_scans.json",
      size: 182,
      url: "https://openneuro.org/crn/datasets/ds003029/objects/1e127e6f7a86868e4fc8b67134aa74190d5838bc?filename=sub-pt01_ses-presurgery_scans.json",
      directory: false,
    },
    {
      id: "fc4b53be715db75856bd0c32d3251318648ffedc",
      filename: "sub-pt01_ses-presurgery_scans.tsv",
      size: 443,
      url: "https://openneuro.org/crn/datasets/ds003029/objects/fc4b53be715db75856bd0c32d3251318648ffedc?filename=sub-pt01_ses-presurgery_scans.tsv",
      directory: false,
    },
    { id: "c6d5b37e1c9fa09bd6c487af66b241cdf3129196", filename: "ieeg", size: 0, url: "", directory: true },
  ]);
  expect(sent()).toMatchObject([{ variables: { datasetId: "ds003029", tag: "1.0.7", tree } }]);
});

test("list_files_reports_graphql_errors", async () => {
  answer({ errors: [{ message: "Not Found" }], data: { snapshot: null } });
  await expect(listFiles("ds003029", "9.9.9")).rejects.toThrow("OpenNeuro: Not Found");
});

const RUN_01 = "sub-pt01_ses-presurgery_task-ictal_acq-ecog_run-01";

test("recording_input_holds_one_recording", async () => {
  answer(ieeg);
  const files = await listFiles("ds003029", "1.0.7", "c6d5b37e1c9fa09bd6c487af66b241cdf3129196");
  const input = recordingInput(files, `${RUN_01}_ieeg.vhdr`);
  // The header, its data and marker files and its BIDS sidecars; the other runs of the folder stay out.
  expect(input).toMatchObject({ kind: "url", primary: `${RUN_01}_ieeg.vhdr` });
  if (input.kind !== "url") throw new Error("not a url input");
  expect(input.files.map((f) => f.name)).toEqual(
    ["channels.tsv", "events.tsv", "ieeg.eeg", "ieeg.json", "ieeg.vhdr", "ieeg.vmrk"].map(
      (suffix) => `${RUN_01}_${suffix}`,
    ),
  );
  // The data file streams from S3 under a key that differs from its BIDS name.
  expect(input.files[2]).toEqual({
    name: `${RUN_01}_ieeg.eeg`,
    size: 105479360,
    url: "https://s3.amazonaws.com/openneuro.org/ds003029/sub-pt1/ses-presurgery/ieeg/sub-pt1_ses-presurgery_task-ictal_acq-ecog_run-01_ieeg.eeg?versionId=SEZcDPr9i2C2tZTbXTOdweF3kj7vVSIK",
  });
});

test("recording_input_without_bids_names_keeps_the_stem", () => {
  const file = (filename: string): RemoteFile => ({
    id: filename,
    filename,
    size: 1,
    url: `u/${filename}`,
    directory: false,
  });
  const input = recordingInput(["a.vhdr", "a.eeg", "a.vmrk", "b.edf"].map(file), "a.vhdr");
  expect(input.kind === "url" && input.files.map((f) => f.name)).toEqual(["a.vhdr", "a.eeg", "a.vmrk"]);
});

test("deep_link_parses", () => {
  expect(parseDeepLink(DEMO)).toEqual({
    datasetId: "ds003029",
    tag: "1.0.7",
    path: `sub-pt01/ses-presurgery/ieeg/${RUN_01}_ieeg.vhdr`,
  });
  expect(parseDeepLink("?openneuro=ds003029&file=a.edf")).toBeNull();
  expect(parseDeepLink("?openneuro=../x&tag=1&file=a.edf")).toBeNull();
  expect(parseDeepLink("")).toBeNull();
});
