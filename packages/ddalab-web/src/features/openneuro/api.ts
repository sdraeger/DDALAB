// OpenNeuro's GraphQL API: public dataset search, the files of a snapshot, and the input that streams one recording.
// File URLs point at S3 (https://s3.amazonaws.com/openneuro.org/..., annexed files, which honor Range) or at
// OpenNeuro's object store (https://openneuro.org/crn/datasets/.../objects/..., small unannexed files).
import type { RecordingInput } from "../../core/engine";

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

/** The most hits a search shows. */
export const SEARCH_LIMIT = 25;
const SEARCH = `query Search($query: DatasetSearchInput!) {
  advancedSearch(query: $query, first: ${SEARCH_LIMIT}) {
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

/** Public datasets matching `query`, best first. */
export async function searchDatasets(query: string, signal: AbortSignal): Promise<DatasetHit[]> {
  const data = await graphql<{ advancedSearch: { edges: ({ node: SearchNode | null } | null)[] } }>(
    SEARCH,
    { query: { keywords: [query], publicOnly: true } },
    signal,
  );
  return data.advancedSearch.edges.flatMap((edge) => {
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
}

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

/** The input that streams `primary` and the rest of its recording's files from their URLs. */
export function recordingInput(files: RemoteFile[], primary: string): RecordingInput {
  return {
    kind: "url",
    primary,
    files: recordingFiles(files, primary).map(({ filename, url, size }) => ({ name: filename, url, size })),
  };
}
