// Project files (.ddalab, core/project.ts): what an export would hold, its writing, and the opening of a project with
// the reattach of its tabs. An export streams to its file (download.ts), reading each recording from its files and
// each result from OPFS a part at a time. An opened project's recordings are read in place, each file a slice of the
// project; its results are copied into OPFS as an imported result is.
import { makeZip } from "client-zip";
import { version } from "../../package.json";
import { type BatchRecord, listBatches, saveBatch } from "../core/batch";
import { bundleFiles } from "../core/exporters";
import { type AnalysisRecord, listAnalyses, persistStorage, resultName } from "../core/history";
import { hasTiles } from "../core/opfs";
import {
  batchIds,
  batchOf,
  type Kept,
  kept,
  type Project,
  type ProjectRecording,
  readProject,
  refusal,
  SCHEMA,
  sameFiles,
  verdict,
} from "../core/project";
import { isScanned, pathOf } from "../core/sources";
import { loadAnnotations } from "../core/userAnnotations";
import { addAnnotations } from "../features/annotations/model";
import { database } from "../store/recent";
import { useStore } from "../store/store";
import {
  idOf,
  remembered,
  rememberedDigests,
  selectTab,
  type Tab,
  type TabFile,
  type TabSource,
  tabOf,
} from "../store/tabs";
import { engineVersion, refreshAnalyses } from "./analyses";
import { download } from "./download";
import { engine, type OpenOptions, type Outcome, openFiles } from "./recordings";
import { attachChecked, reattachFrom } from "./tabs";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A recording of an export: its tab, its open recording, and each file it read with where its bytes come from. */
interface Member {
  tab: Tab;
  id: string;
  /** `bytes`: the file, or the address of a recording streamed from one. */
  files: { name: string; size: number; lastModified: number; bytes: File | string }[];
}

/** What an export would hold now, and why tabs cannot go in. */
export interface Contents {
  members: Member[];
  /** The complete results of its recordings, each with the files of its bundle. */
  results: { record: AnalysisRecord; files: { name: string; input: File }[] }[];
  batches: BatchRecord[];
  active: string | null;
  /** Bytes of the recordings' files and the results' bundles. */
  bytes: number;
  /** A sentence per tab or result that cannot go in, with what to do. */
  problems: string[];
}

/** The first of `files` the browser no longer reads (changed, moved, or its permission lapsed); `undefined` if none. */
async function unreadable(files: File[]) {
  for (const file of files) {
    try {
      await file.slice(0, 1).arrayBuffer();
    } catch {
      return file.name;
    }
  }
  return undefined;
}

/**
 * What an export of the open tabs would hold: each tab's recording with every file it read, the complete results of
 * those recordings, and the batches they belong to. A detached tab, or a file the browser no longer reads, is a problem
 * to solve first.
 */
export async function projectContents(): Promise<Contents> {
  const s = useStore.getState();
  const { tabs, active } = remembered();
  const members: Member[] = [];
  const problems: string[] = [];
  for (const tab of tabs) {
    const id = idOf(tab.fingerprint, s.recordings);
    const input = id === undefined ? undefined : engine.input(id);
    if (id === undefined || !input) {
      problems.push(`${tab.name} is detached. Reattach it, or close its tab.`);
      continue;
    }
    const names = s.recordings[id].info.input_files;
    if (input.kind === "files") {
      const files = names.map((name) => input.files.find((f) => f.name === name) as File);
      const lost = await unreadable(files);
      if (lost) problems.push(`${lost} can no longer be read. Open ${tab.name} again, or close its tab.`);
      else {
        const own = files.map((f) => ({
          name: f.name,
          size: f.size,
          lastModified: f.lastModified,
          bytes: f,
        }));
        members.push({ tab, id, files: own });
      }
    } else if (input.kind === "url" && isScanned(input)) {
      const files = names.flatMap((name) => input.files.filter((f) => f.name === name));
      const own = files.map(({ name, size, url }) => ({ name, size, lastModified: Date.now(), bytes: url }));
      members.push({ tab, id, files: own });
    } else {
      problems.push(
        `${tab.name} streams from its address and is above 1 GiB. Download its files and open them to include it.`,
      );
    }
  }
  const prints = new Set(members.map((m) => m.tab.fingerprint));
  const results: Contents["results"] = [];
  for (const record of s.analyses) {
    if (record.status !== "complete" || !prints.has(record.fingerprint)) continue;
    try {
      results.push({ record, files: await bundleFiles(record.id, `results/${record.id}/`) });
    } catch (error) {
      problems.push(`The result ${resultName(record)} could not be read: ${messageOf(error)}`);
    }
  }
  const batches = s.batches.filter((b) => results.some((r) => r.record.batch === b.id));
  const sizes = [...members.flatMap((m) => m.files), ...results.flatMap((r) => r.files.map((f) => f.input))];
  const bytes = sizes.reduce((sum, f) => sum + f.size, 0);
  return { members, results, batches, active: active && prints.has(active) ? active : null, bytes, problems };
}

/** A recording streamed from its address, as client-zip reads it. */
async function fetched(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

/** The project.json of `contents`; it waits for the SHA-256 of every recording file. */
async function projectJson(contents: Contents, created: Date): Promise<Project> {
  const facts = await engineVersion;
  const { annotations } = useStore.getState();
  const recordings: Project["recordings"] = [];
  for (const [k, { tab, id, files }] of contents.members.entries()) {
    const sha256 = await engine.hashes(id);
    const missing = files.find((f) => !sha256[f.name]);
    if (missing)
      throw new Error(`${missing.name} could not be hashed, and a project records every file's SHA-256`);
    recordings.push({
      fingerprint: tab.fingerprint,
      files: files.map(({ name, size, lastModified }) => ({
        path: `recordings/${k}/${name}`,
        name,
        size,
        sha256: sha256[name],
        last_modified: lastModified,
      })),
      annotations: annotations[tab.fingerprint] ?? (await loadAnnotations(tab.fingerprint)),
      saved: tab.saved ?? null,
      channel_query: tab.channelQuery,
    });
  }
  // A result names its batch only when the batch goes along.
  const carried = new Set(contents.batches.map((b) => b.id));
  return {
    schema: SCHEMA,
    app_version: version,
    engine_version: facts.engine_version,
    git_commit: facts.git_commit,
    created_at_iso: created.toISOString(),
    recordings,
    active_tab: contents.active,
    results: contents.results.map(({ record }) => ({
      path: `results/${record.id}/`,
      record: kept({
        ...record,
        batch: record.batch && carried.has(record.batch) ? record.batch : undefined,
      }),
    })),
    batches: contents.batches.map(batchOf),
  };
}

/** The day `date` is in, where the user is, as YYYY-MM-DD. */
const dayOf = (date: Date) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");

/**
 * Saves `contents` as a project named for the day: project.json first in the making, as it waits for every recording's
 * SHA-256 and a recording that cannot be hashed fails the export before anything is written; then the archive streams,
 * every recording's files, every result's bundle, and project.json last. Call it first thing in a click: the Save
 * dialog needs the click (download.ts). `onMake` hears when the making starts, after the dialog.
 */
export function exportProject(contents: Contents, onMake: () => void) {
  const created = new Date();
  return download(`project-${dayOf(created)}.ddalab`, async () => {
    onMake();
    const json = `${JSON.stringify(await projectJson(contents, created), null, 2)}\n`;
    async function* files() {
      for (const [k, { files }] of contents.members.entries()) {
        for (const { name, size, lastModified, bytes } of files) {
          const input = typeof bytes === "string" ? await fetched(bytes) : bytes;
          yield { name: `recordings/${k}/${name}`, size, lastModified, input };
        }
      }
      for (const { files } of contents.results) yield* files;
      yield { name: "project.json", input: json };
    }
    return makeZip(files());
  });
}

/** The projects read so far, by File: the tabs of one project reattach from one read of its directory. */
const reads = new WeakMap<File, ReturnType<typeof readProject>>();
function read(file: File) {
  let found = reads.get(file);
  if (!found) {
    found = readProject(file, file.name);
    reads.set(file, found);
    found.catch(() => reads.delete(file));
  }
  return found;
}

const tabFileOf = (file: File, handle?: FileSystemFileHandle): TabFile => ({
  path: pathOf(file),
  name: file.name,
  size: file.size,
  lastModified: file.lastModified,
  handle,
});

/** The files of `recording` as Files over its bytes in the project: nothing is copied. */
const filesIn = (recording: ProjectRecording, entries: Map<string, Blob>) =>
  recording.files.map(
    ({ path, name, last_modified }) =>
      new File([entries.get(path) as Blob], name, { lastModified: last_modified }),
  );

/**
 * Opens the recording of `options.expect` (the tab's fingerprint) in the project `file` as `openFiles` opens files, each
 * file a slice of the project, and its tab reads it from this project from now on. The recording is found by its
 * content, wherever the project lists it, and must have the SHA-256 its tab holds. `options.handles` holds the
 * project's handle where the browser gives one.
 */
export async function openProjectRecording(
  file: File,
  options: OpenOptions & { expect: string },
): Promise<Outcome> {
  const fingerprint = options.expect;
  const tab = tabOf(fingerprint);
  let files: File[];
  try {
    const { project, entries } = await read(file);
    const recording = project.recordings.find((r) => r.fingerprint === fingerprint);
    if (!recording) throw new Error(`${file.name} does not hold ${tab?.name ?? "this recording"}`);
    if (tab?.sha256 && !sameFiles(recording.files, tab.sha256)) {
      throw new Error(
        `${tab.name} in ${file.name} has other contents than the ${tab.name} of this tab (SHA-256)`,
      );
    }
    files = filesIn(recording, entries);
  } catch (error) {
    return { kind: "error", message: messageOf(error), folder: false };
  }
  const origin: TabSource = { kind: "project", project: tabFileOf(file, options.handles?.files?.[0]) };
  return openFiles(files, { ...options, choice: files[0].name, handles: undefined, origin });
}

/**
 * What this browser keeps under a recording's fingerprint (core/project.ts `Kept`): its tab, open or detached, its
 * annotations, its results and its cached tiles, and each set of its files' SHA-256 known here: the open recording's
 * (hashed now if need be) or its tab's, those its results recorded as their input, and those kept from when it was last
 * hashed (store/tabs.ts `rememberDigests`).
 */
async function keptHere(fingerprint: string, analyses: AnalysisRecord[]): Promise<Kept> {
  const id = idOf(fingerprint);
  const tab = tabOf(fingerprint);
  const [annotations, tiles, remembered, own] = await Promise.all([
    loadAnnotations(fingerprint).catch(() => []),
    hasTiles(fingerprint),
    rememberedDigests(fingerprint).catch(() => undefined),
    id ? engine.hashes(id) : tab?.sha256,
  ]);
  const results = analyses.filter((a) => a.fingerprint === fingerprint);
  const digests = [own, remembered, ...results.map((a) => a.manifest?.reproduction.input_sha256)];
  return {
    tab: id ? "open" : tab ? "detached" : "none",
    annotations: annotations.length,
    results: results.length,
    tiles,
    digests: digests.filter((d) => d !== undefined),
  };
}

/**
 * Adds the results of the recordings in `joins` and their batches, beside what is here. A result here already (by id)
 * stays as it is. A batch id this browser has for another batch gets a new id, which the project's results of that
 * batch take; a result joins a batch here only when that batch lists it. Rejects, adding nothing, when the history or
 * the batches cannot be listed: a result or a batch here could be written over.
 */
async function addResults(
  { results, batches }: Project,
  entries: Map<string, Blob>,
  source: string,
  joins: Set<string>,
  problems: string[],
) {
  const [analyses, stored] = await Promise.all([listAnalyses(), listBatches()]);
  const ids = batchIds(batches, stored);
  const have = new Set(analyses.map((a) => a.id));
  // Each result's bundle files, by its folder, in one pass over the entries.
  const bundles = new Map<string, { path: string; file: Blob }[]>();
  for (const [name, file] of entries) {
    const folder = /^results\/[^/]+\//.exec(name)?.[0];
    if (!folder) continue;
    const files = bundles.get(folder) ?? [];
    files.push({ path: `${source}/${name}`, file });
    bundles.set(folder, files);
  }
  const fresh = results.filter((r) => joins.has(r.record.fingerprint) && !have.has(r.record.id));
  const imports = fresh.map(({ path, record }) => {
    const target = record.batch ? ids.get(record.batch) : undefined;
    const here = stored.find((b) => b.id === target);
    const batch = !here || here.results.some((r) => r.resultId === record.id) ? target : undefined;
    return { input: bundles.get(path) ?? [], kept: { ...record, batch } };
  });
  const named = new Set(fresh.map((r) => r.record.batch));
  const wanted = batches.filter((b) => named.has(b.id) && !stored.some((o) => o.id === ids.get(b.id)));
  // The results' records and their batches together are bounded (imports.ts): above it none is added, and this says
  // why.
  const outcomes = imports.length > 0 ? await engine.importResults(imports, wanted) : [];
  const joined = fresh.filter((_, i) => "id" in outcomes[i]);
  for (const [i, outcome] of outcomes.entries()) {
    if ("error" in outcome)
      problems.push(`A result of ${fresh[i].record.fileName} was not added: ${outcome.error}`);
  }
  if (joined.length > 0) {
    void persistStorage();
    await refreshAnalyses();
  }
  const used = new Set(joined.map((r) => r.record.batch));
  const added = wanted.filter((b) => used.has(b.id));
  for (const batch of added) {
    await saveBatch({ ...batch, id: ids.get(batch.id) as string }).catch((error) =>
      problems.push(`A batch was not added: ${messageOf(error)}`),
    );
  }
  if (added.length > 0) {
    useStore.setState({ batches: await listBatches().catch(() => useStore.getState().batches) });
  }
}

/**
 * Opens the project `file` (`handle`: its handle, where the browser gives one), after any open under way in any window
 * of the app (a Web Lock), so two opens never write one result at once. A recording that a tab here holds joins the
 * project only once the project's bytes of it, hashed, have that tab's SHA-256 (`verdict`); one that does not is
 * refused with what to do, and the user's tab, its source, annotations and results stay as they are. For the
 * recordings that join, the project's results join the history, their batches the batches and its annotations theirs,
 * beside whatever is here (`addResults`, `addAnnotations`). A detached tab here of one of them attaches from the
 * project's checked bytes and keeps its own source; the others get tabs of their own, read from the project, after the
 * open ones. The project's selected tab is selected. Why a tab did not open is its reason (tabs.ts); what was not added
 * is the outcome's warning.
 */
export function openProject(file: File, handle?: FileSystemFileHandle): Promise<Outcome> {
  return navigator.locks.request("ddalab-project-open", () => openOne(file, handle));
}

async function openOne(file: File, handle?: FileSystemFileHandle): Promise<Outcome> {
  let found: Awaited<ReturnType<typeof readProject>>;
  try {
    found = await read(file);
  } catch (error) {
    return { kind: "error", message: messageOf(error), folder: false };
  }
  const { project, entries } = found;
  const problems: string[] = [];
  const joins = new Set<string>();
  /** Detached tabs here whose recording the project's bytes match, with those bytes. */
  const checked: { fingerprint: string; files: File[] }[] = [];
  const analyses = await listAnalyses().catch(() => []);
  for (const recording of project.recordings) {
    const { fingerprint, files } = recording;
    const here = await keptHere(fingerprint, analyses);
    const judged = await verdict(recording, here, () => engine.digests(filesIn(recording, entries)));
    if (judged !== "new" && judged !== "same") {
      problems.push(refusal(files[0].name, file.name, judged, here));
      continue;
    }
    joins.add(fingerprint);
    if (judged === "same" && here.tab === "detached" && !idOf(fingerprint)) {
      checked.push({ fingerprint, files: filesIn(recording, entries) });
    }
    // Nothing of it is kept here: a list of the file's own annotations cached under its fingerprint is read again.
    if (judged === "new")
      await database()
        .then((db) => db.delete("fileAnnotations", fingerprint))
        .catch(() => {});
  }
  await addResults(project, entries, file.name, joins, problems).catch((error) =>
    problems.push(`The results of ${file.name} were not added: ${messageOf(error)}.`),
  );
  for (const { fingerprint, annotations, files } of project.recordings) {
    if (!joins.has(fingerprint)) continue;
    await addAnnotations(fingerprint, annotations).catch((error) =>
      problems.push(`The annotations of ${files[0].name} were not added: ${messageOf(error)}`),
    );
  }
  const source: TabSource = { kind: "project", project: tabFileOf(file, handle) };
  const added = project.recordings.flatMap((r): Tab[] =>
    !joins.has(r.fingerprint) || tabOf(r.fingerprint)
      ? []
      : [
          {
            fingerprint: r.fingerprint,
            name: r.files[0].name,
            source,
            saved: r.saved ?? undefined,
            channelQuery: r.channel_query,
            sha256: Object.fromEntries(r.files.map((f) => [f.name, f.sha256])),
          },
        ],
  );
  useStore.setState((s) => ({ tabs: [...s.tabs, ...added] }));
  if (project.active_tab && joins.has(project.active_tab)) selectTab(project.active_tab);
  const fresh = new Set(added.map((t) => t.fingerprint));
  await Promise.all([
    ...checked.map(({ fingerprint, files }) => attachChecked(fingerprint, files)),
    reattachFrom([file], null, handle && { files: [handle] }, fresh),
  ]);
  return {
    kind: "opened",
    id: useStore.getState().activeRecordingId ?? "",
    warning: problems.length > 0 ? problems.join(" ") : undefined,
  };
}
