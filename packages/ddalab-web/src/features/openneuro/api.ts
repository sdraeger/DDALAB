// OpenNeuro's GraphQL API: public dataset search, a snapshot's description and files, and the inputs that stream its
// recordings, which cite the dataset.
// File URLs point at S3 (https://s3.amazonaws.com/openneuro.org/..., annexed files, which honor Range) or at
// OpenNeuro's object store (https://openneuro.org/crn/datasets/.../objects/..., small unannexed files).
import { discovered, MAX_DEPTH, SKIPPED } from "../../core/batch";
import type { DatasetSource, RecordingInput } from "../../core/engine";

/** The files a recording opens from; the BIDS text files beside them are its sidecars. */
export const RECORDING = /\.(vhdr|edf|bdf)$/i;

const ENDPOINT = "https://openneuro.org/crn/graphql";
const UNREACHABLE = "OpenNeuro could not be reached. Recordings on this computer still open.";
const UNREADABLE = "OpenNeuro sent an answer DDALAB cannot read. Try again later.";

export interface DatasetHit {
  id: string;
  name: string;
  /** The latest snapshot, which the panel browses and links pin. */
  tag: string;
  modalities: string[];
  subjects: number;
  /** Bytes. */
  size: number;
}

export interface RemoteFile {
  /** For a directory, the tree `listFiles` takes. */
  id: string;
  filename: string;
  size: number;
  /** Empty for a directory. */
  url: string;
  directory: boolean;
}

/** The `data` of an answer to `query`; an answer with errors fails with the first. */
async function graphql<T>(query: string, variables: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal,
  }).catch((error: Error) => {
    throw error.name === "AbortError" ? error : new Error(UNREACHABLE);
  });
  if (!response.ok) throw new Error(`OpenNeuro answered ${response.status}`);
  // A proxy or sign-in portal can answer in OpenNeuro's place with a page.
  const { data, errors } = await response.json().catch((error: Error) => {
    throw error.name === "SyntaxError" ? new Error(UNREADABLE) : error;
  });
  if (errors?.length) throw new Error(`OpenNeuro: ${errors[0].message}`);
  return data;
}

/** The most hits a page of search results shows. */
export const PAGE_SIZE = 25;
const SEARCH = `query Search($query: DatasetSearchInput!, $after: String) {
  advancedSearch(query: $query, first: ${PAGE_SIZE}, after: $after) {
    pageInfo { count hasNextPage endCursor }
    edges { node { id latestSnapshot { tag description { Name } summary { modalities subjects size } } } }
  }
}`;

interface SearchNode {
  id: string;
  latestSnapshot: {
    tag: string;
    description: { Name: string } | null;
    summary: { modalities: string[]; subjects: string[]; size: number } | null;
  } | null;
}

/** How OpenNeuro orders the hits: by relevance to the words, newest first, or by name. */
export type Sort = "relevance" | "newest" | "name_asc";

/** A search: its words (may be empty), the modality its datasets hold (empty for any), and their order. */
export interface Search {
  keywords: string;
  modality: string;
  sort: Sort;
}

/** A page of hits, how many datasets match in all, and the cursor of the next page (`null` after the last). */
export interface SearchPage {
  hits: DatasetHit[];
  count: number;
  next: string | null;
}

/** The page of public datasets matching `search` after cursor `after` (`null` for the first page). */
export async function searchDatasets(
  search: Search,
  after: string | null,
  signal: AbortSignal,
): Promise<SearchPage> {
  const query = {
    ...(search.keywords && { keywords: [search.keywords] }),
    ...(search.modality && { modality: search.modality }),
    publicOnly: true,
    sortBy: search.sort,
  };
  const data = await graphql<{
    advancedSearch: {
      pageInfo?: { count: number; hasNextPage: boolean; endCursor: string | null };
      edges: ({ node: SearchNode | null } | null)[];
    };
  }>(SEARCH, { query, after }, signal);
  const { pageInfo, edges } = data.advancedSearch;
  const hits = edges.flatMap((edge) => {
    const snapshot = edge?.node?.latestSnapshot;
    if (!edge?.node || !snapshot) return [];
    return {
      id: edge.node.id,
      name: snapshot.description?.Name?.trim() || edge.node.id,
      tag: snapshot.tag,
      modalities: snapshot.summary?.modalities ?? [],
      subjects: snapshot.summary?.subjects?.length ?? 0,
      size: snapshot.summary?.size ?? 0,
    };
  });
  return {
    hits,
    count: pageInfo?.count ?? hits.length,
    next: pageInfo?.hasNextPage && pageInfo.endCursor ? pageInfo.endCursor : null,
  };
}

/** A snapshot of a dataset as its page describes it. */
export interface DatasetInfo {
  /** The dataset's snapshots, newest first. */
  tags: string[];
  name: string;
  authors: string[];
  license: string;
  /** Without a `doi:` or resolver prefix; empty where the snapshot has none. */
  doi: string;
  /** The dataset's own words on how to cite it. */
  acknowledge: string;
  readme: string;
  /** When the snapshot was made, an ISO date; empty where unknown. */
  created: string;
}

const INFO = `query Info($datasetId: ID!, $tag: String!) {
  dataset(id: $datasetId) { snapshots { tag created } }
  snapshot(datasetId: $datasetId, tag: $tag) {
    readme description { Name Authors License DatasetDOI HowToAcknowledge }
  }
}`;

/** The snapshots of dataset `datasetId`, and the description and README of its snapshot `tag`. */
export async function datasetInfo(datasetId: string, tag: string): Promise<DatasetInfo> {
  const data = await graphql<{
    dataset: { snapshots: { tag: string; created: string | null }[] } | null;
    snapshot: {
      readme: string | null;
      description: {
        Name: string | null;
        Authors: string[] | null;
        License: string | null;
        DatasetDOI: string | null;
        HowToAcknowledge: string | null;
      } | null;
    } | null;
  }>(INFO, { datasetId, tag });
  const snapshots = data.dataset?.snapshots ?? [];
  const description = data.snapshot?.description;
  return {
    tags: snapshots.map((s) => s.tag).reverse(),
    name: description?.Name?.trim() || datasetId,
    authors: (description?.Authors ?? []).map((a) => a.trim()).filter(Boolean),
    license: description?.License?.trim() ?? "",
    doi: (description?.DatasetDOI ?? "").trim().replace(/^(doi:\s*|https?:\/\/(dx\.)?doi\.org\/)/i, ""),
    acknowledge: description?.HowToAcknowledge?.trim() ?? "",
    readme: data.snapshot?.readme?.trim() ?? "",
    created: snapshots.find((s) => s.tag === tag)?.created ?? "",
  };
}

/** The reference of snapshot `tag` of `datasetId` as OpenNeuro words it: authors (year). name. OpenNeuro. DOI. */
export function citationOf(datasetId: string, tag: string, info?: DatasetInfo): string {
  if (!info) return `OpenNeuro dataset ${datasetId}, version ${tag}.`;
  const who = info.authors.length > 0 ? `${info.authors.join(", ")} ` : "";
  const when = info.created ? `(${info.created.slice(0, 4)}). ` : "";
  const where = info.doi ? `doi:${info.doi}` : `${datasetId}, version ${tag}`;
  return `${who}${when}${info.name}. OpenNeuro. [Dataset] ${where}`;
}

/** The source of the recording at `path` in snapshot `tag` of `datasetId`, described by `info` where it was read. */
export const sourceOf = (
  datasetId: string,
  tag: string,
  path: string,
  info?: DatasetInfo,
): DatasetSource => ({
  id: datasetId,
  tag,
  path,
  name: info?.name ?? datasetId,
  doi: info?.doi ?? "",
  license: info?.license ?? "",
  citation: citationOf(datasetId, tag, info),
});

const FILES = `query Files($datasetId: ID!, $tag: String!, $tree: String) {
  snapshot(datasetId: $datasetId, tag: $tag) { files(tree: $tree) { id filename size directory urls } }
}`;

/** The files and directories at the top of snapshot `tag`, or in directory `tree` of it. */
export async function listFiles(datasetId: string, tag: string, tree?: string): Promise<RemoteFile[]> {
  const data = await graphql<{
    snapshot: { files: (Omit<RemoteFile, "url"> & { urls: string[] })[] };
  }>(FILES, { datasetId, tag, tree });
  return data.snapshot.files.map(({ id, filename, size, directory, urls }) => ({
    id,
    filename,
    size,
    url: urls[0] ?? "",
    directory,
  }));
}

/** `name` without its extension. */
const stem = (name: string) => name.replace(/\.[^.]*$/, "");

/**
 * The files of recording `primary` in `files`, the listing of its directory, by the names the core looks for: the
 * files of its stem (data, markers, `<prefix>_<modality>.json`) and, for a BIDS name `<prefix>_<modality>`,
 * `<prefix>_channels.tsv` and `<prefix>_events.tsv`. Other recordings in the directory stay out: they would count
 * toward the size above which remote recordings are not scanned.
 */
export function recordingFiles(files: RemoteFile[], primary: string): RemoteFile[] {
  const own = stem(primary);
  const cut = own.lastIndexOf("_");
  const sidecars =
    cut > 0 ? ["channels.tsv", "events.tsv"].map((name) => `${own.slice(0, cut)}_${name}`) : [];
  return files.filter(
    (file) => !file.directory && (stem(file.filename) === own || sidecars.includes(file.filename)),
  );
}

/** The input that streams `primary` and the rest of its recording's files from their URLs, out of `dataset`. */
export function recordingInput(
  files: RemoteFile[],
  primary: string,
  dataset?: DatasetSource,
): RecordingInput {
  return {
    kind: "url",
    primary,
    files: recordingFiles(files, primary).map(({ filename, url, size }) => ({ name: filename, url, size })),
    ...(dataset && { dataset }),
  };
}

/** A recording found by `walkRecordings`: its path from the dataset's id and the input that streams it. */
export interface RemoteRecording {
  path: string;
  input: RecordingInput;
}

/** How many folders `walkRecordings` lists at once. */
const LISTINGS = 6;

/**
 * The recordings `ddalab batch --bids-dir` would find in folder `top` of snapshot `tag` of `datasetId` and below it,
 * in its order, each citing the dataset as `info` describes it. `top.path` is the folder's path from the dataset's id
 * (the id itself for its top folder). Folders the batch skips are never listed.
 */
export async function walkRecordings(
  datasetId: string,
  tag: string,
  top: { path: string; tree?: string },
  info?: DatasetInfo,
): Promise<RemoteRecording[]> {
  const found: RemoteRecording[] = [];
  let level = [top];
  while (level.length > 0) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; i += LISTINGS) {
      const listed = await Promise.all(
        level.slice(i, i + LISTINGS).map(async (folder) => ({
          folder,
          files: await listFiles(datasetId, tag, folder.tree),
        })),
      );
      for (const { folder, files } of listed) {
        for (const file of files) {
          const path = `${folder.path}/${file.filename}`;
          const depth = path.split("/").length - 2;
          if (file.directory) {
            const skipped = file.filename.startsWith(".") || SKIPPED.includes(file.filename);
            if (!skipped && depth < MAX_DEPTH) next.push({ path, tree: file.id });
          } else if (RECORDING.test(file.filename)) {
            const inDataset = path.slice(datasetId.length + 1);
            found.push({
              path,
              input: recordingInput(files, file.filename, sourceOf(datasetId, tag, inDataset, info)),
            });
          }
        }
      }
    }
    level = next;
  }
  return discovered(found, datasetId);
}
