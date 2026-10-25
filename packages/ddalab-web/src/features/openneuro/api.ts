// OpenNeuro's GraphQL API: public dataset search, the files of a snapshot, and the input that streams one recording.
// File URLs point at S3 (https://s3.amazonaws.com/openneuro.org/..., annexed files, which honor Range) or at
// OpenNeuro's object store (https://openneuro.org/crn/datasets/.../objects/..., small unannexed files).
import type { RecordingInput } from "../../core/engine";

const ENDPOINT = "https://openneuro.org/crn/graphql";
const UNREACHABLE = "OpenNeuro could not be reached. Recordings on this computer still open.";

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
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(`OpenNeuro: ${errors[0].message}`);
  return data;
}

const SEARCH = `query Search($query: DatasetSearchInput!) {
  advancedSearch(query: $query, first: 25) {
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

/**
 * The files of recording `primary` in `files`, the listing of its directory: those that share its BIDS prefix
 * (`<prefix>_<suffix>`), which hold its data, markers and sidecars, or its stem without one. Other runs in the
 * directory stay out: they would count toward the size above which remote recordings are not scanned.
 */
export function recordingFiles(files: RemoteFile[], primary: string): RemoteFile[] {
  const prefix = primary.slice(0, primary.lastIndexOf("_") + 1) || primary.slice(0, primary.indexOf(".") + 1);
  return files.filter((file) => !file.directory && file.filename.startsWith(prefix));
}

/** The input that streams `primary` and the rest of its recording's files from their URLs. */
export function recordingInput(files: RemoteFile[], primary: string): RecordingInput {
  return {
    kind: "url",
    primary,
    files: recordingFiles(files, primary).map(({ filename, url, size }) => ({ name: filename, url, size })),
  };
}
