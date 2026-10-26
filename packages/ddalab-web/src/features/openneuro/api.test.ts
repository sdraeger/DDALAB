// The OpenNeuro client against GraphQL answers recorded from https://openneuro.org/crn/graphql on 2026-10-25
// (ds003029 at 1.0.7; the search answer keeps its first three hits).
import { afterEach, expect, test, vi } from "vitest";
import {
  citationOf,
  datasetInfo,
  listFiles,
  type RemoteFile,
  recordingFiles,
  recordingInput,
  type Search,
  searchDatasets,
  sourceOf,
  walkRecordings,
} from "./api";
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

const WORDS: Search = { keywords: "epilepsy ieeg", modality: "", sort: "relevance" };

test("search_parses_hits", async () => {
  const sent = answer(search);
  const signal = new AbortController().signal;
  const page = await searchDatasets(WORDS, null, signal);
  // An answer without page information (as recorded) is one page of every hit.
  expect(page.count).toBe(3);
  expect(page.next).toBeNull();
  expect(page.hits).toEqual([
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
      variables: {
        query: { keywords: ["epilepsy ieeg"], publicOnly: true, sortBy: "relevance" },
        after: null,
      },
    },
  ]);
});

test("search_filters_and_pages", async () => {
  const pageInfo = { count: 465, hasNextPage: true, endCursor: "c2" };
  const sent = answer({ data: { advancedSearch: { pageInfo, edges: search.data.advancedSearch.edges } } });
  const asked: Search = { keywords: "", modality: "eeg", sort: "newest" };
  const page = await searchDatasets(asked, "c1", new AbortController().signal);
  expect(page).toMatchObject({ count: 465, next: "c2" });
  // No words: none are sent.
  expect(sent()[0].variables).toEqual({
    query: { modality: "eeg", publicOnly: true, sortBy: "newest" },
    after: "c1",
  });
  answer({ data: { advancedSearch: { pageInfo: { ...pageInfo, hasNextPage: false }, edges: [] } } });
  expect((await searchDatasets(asked, "c2", new AbortController().signal)).next).toBeNull();
});

test("search_skips_datasets_without_a_snapshot", async () => {
  answer({ data: { advancedSearch: { edges: [null, { node: { id: "ds000001", latestSnapshot: null } }] } } });
  expect((await searchDatasets(WORDS, null, new AbortController().signal)).hits).toEqual([]);
});

/** ds003029's answer to the description query, as recorded on 2026-10-26 (its README cut short). */
const INFO_ANSWER = {
  data: {
    dataset: {
      snapshots: [
        { tag: "1.0.6", created: "2023-09-05T23:05:39.000Z" },
        { tag: "1.0.7", created: "2023-11-28T15:39:44.000Z" },
      ],
    },
    snapshot: {
      readme: "Fragility Multi-Center Retrospective Study\n",
      description: {
        Name: "Epilepsy-iEEG-Multicenter-Dataset",
        Authors: ["Adam Li", "Sara Inati", " "],
        License: "CC0",
        DatasetDOI: "doi:10.18112/openneuro.ds003029.v1.0.7",
        HowToAcknowledge: "Please cite: https://doi.org/10.1101/862797",
      },
    },
  },
};

test("dataset_info_reads_the_description", async () => {
  const sent = answer(INFO_ANSWER);
  const info = await datasetInfo("ds003029", "1.0.7");
  expect(info).toEqual({
    tags: ["1.0.7", "1.0.6"],
    name: "Epilepsy-iEEG-Multicenter-Dataset",
    authors: ["Adam Li", "Sara Inati"],
    license: "CC0",
    doi: "10.18112/openneuro.ds003029.v1.0.7",
    acknowledge: "Please cite: https://doi.org/10.1101/862797",
    readme: "Fragility Multi-Center Retrospective Study",
    created: "2023-11-28T15:39:44.000Z",
  });
  expect(sent()[0].variables).toEqual({ datasetId: "ds003029", tag: "1.0.7" });
  expect(citationOf("ds003029", "1.0.7", info)).toBe(
    "Adam Li, Sara Inati (2023). Epilepsy-iEEG-Multicenter-Dataset. OpenNeuro. [Dataset] doi:10.18112/openneuro.ds003029.v1.0.7",
  );
  // Without a description the citation names the dataset and its snapshot.
  expect(citationOf("ds003029", "1.0.7")).toBe("OpenNeuro dataset ds003029, version 1.0.7.");
  expect(sourceOf("ds003029", "1.0.7", "sub-pt01/a.vhdr", info)).toMatchObject({
    path: "sub-pt01/a.vhdr",
    doi: "10.18112/openneuro.ds003029.v1.0.7",
    license: "CC0",
  });
});

test("walk_finds_the_batch_recordings_below_a_folder", async () => {
  const entry = (filename: string, directory = false) => ({
    id: `tree-${filename}`,
    filename,
    size: directory ? 0 : 10,
    directory,
    urls: directory ? [] : [`https://s3/${filename}`],
  });
  const trees: Record<string, ReturnType<typeof entry>[]> = {
    top: [entry("sub-02", true), entry("sub-01", true), entry("derivatives", true), entry("README")],
    "tree-sub-01": [entry("eeg", true)],
    "tree-sub-02": [entry("eeg", true)],
    "tree-eeg": [entry("sub-x_task-rest_eeg.edf"), entry("sub-x_task-rest_events.tsv"), entry("notes.edf")],
    "tree-derivatives": [entry("sub-y_eeg.edf")],
  };
  const listed: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const tree = JSON.parse(init.body as string).variables.tree ?? "top";
    listed.push(tree);
    return new Response(JSON.stringify({ data: { snapshot: { files: trees[tree] } } }));
  });
  const found = await walkRecordings("ds000001", "1.0.0", { path: "ds000001" });
  // `ddalab batch`'s recordings in its order, citing the dataset; derivatives are never listed.
  expect(found.map((r) => r.path)).toEqual([
    "ds000001/sub-01/eeg/sub-x_task-rest_eeg.edf",
    "ds000001/sub-02/eeg/sub-x_task-rest_eeg.edf",
  ]);
  expect(listed).not.toContain("tree-derivatives");
  const input = found[0].input;
  if (input.kind !== "url") throw new Error("not a url input");
  expect(input.files.map((f) => f.name)).toEqual(["sub-x_task-rest_eeg.edf", "sub-x_task-rest_events.tsv"]);
  expect(input.dataset).toMatchObject({
    id: "ds000001",
    tag: "1.0.0",
    path: "sub-01/eeg/sub-x_task-rest_eeg.edf",
  });
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

test("recording_files_match_names_exactly", () => {
  const file = (filename: string): RemoteFile => ({
    id: filename,
    filename,
    size: 1,
    url: `u/${filename}`,
    directory: false,
  });
  const names = (primary: string, ...listing: string[]) =>
    recordingFiles(listing.map(file), primary).map((f) => f.filename);
  // A longer BIDS name is another recording.
  const bids = [
    "sub-01_task-rest_eeg.edf",
    "sub-01_task-rest_eeg.json",
    "sub-01_task-rest_events.tsv",
    "sub-01_task-rest_acq-x_eeg.edf",
    "sub-01_task-rest_acq-x_events.tsv",
  ];
  expect(names("sub-01_task-rest_eeg.edf", ...bids)).toEqual(bids.slice(0, 3));
  // Without BIDS sidecars, the files of the same stem.
  expect(names("a.vhdr", "a.vhdr", "a.eeg", "a.vmrk", "b.edf")).toEqual(["a.vhdr", "a.eeg", "a.vmrk"]);
  expect(names("EEG_1.edf", "EEG_1.edf", "EEG_2.edf", "EEG_10.edf")).toEqual(["EEG_1.edf"]);
});

test("an_answer_that_is_not_json_reads_as_a_sentence", async () => {
  vi.stubGlobal("fetch", async () => new Response("<html>Sign in to this network</html>"));
  await expect(listFiles("ds003029", "1.0.7")).rejects.toThrow(
    "OpenNeuro sent an answer DDALAB cannot read. Try again later.",
  );
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
