// Links that open an OpenNeuro recording: `?openneuro=<dataset>&tag=<snapshot>&file=<path in the dataset>`.
import type { RecordingInput } from "../../core/engine";
import { datasetInfo, listFiles, recordingInput, sourceOf } from "./api";

export interface DeepLink {
  datasetId: string;
  tag: string;
  path: string;
}

/** ds003029 `sub-pt01` run 1 at its latest snapshot (1.0.7, looked up on 2026-10-25). */
export const DEMO =
  "?openneuro=ds003029&tag=1.0.7&file=sub-pt01/ses-presurgery/ieeg/sub-pt01_ses-presurgery_task-ictal_acq-ecog_run-01_ieeg.vhdr";

export function parseDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search);
  const [datasetId, tag, path] = ["openneuro", "tag", "file"].map((key) => params.get(key) ?? "");
  return /^ds\d+$/.test(datasetId) && tag && path ? { datasetId, tag, path } : null;
}

/**
 * The input of the recording `link` names, found by walking its path one directory at a time. It cites the dataset as
 * its description reads, or by its id and snapshot where the description does not come.
 */
export async function linkedInput({ datasetId, tag, path }: DeepLink): Promise<RecordingInput> {
  const info = datasetInfo(datasetId, tag).catch(() => undefined);
  const names = path.split("/").filter(Boolean);
  const primary = names.pop() ?? "";
  let files = await listFiles(datasetId, tag);
  for (const name of names) {
    const directory = files.find((file) => file.directory && file.filename === name);
    if (!directory) throw new Error(`${datasetId} ${tag} has no folder ${name}`);
    files = await listFiles(datasetId, tag, directory.id);
  }
  if (!files.some((file) => !file.directory && file.filename === primary)) {
    throw new Error(`${datasetId} ${tag} has no file ${path}`);
  }
  return recordingInput(files, primary, sourceOf(datasetId, tag, path, await info));
}
