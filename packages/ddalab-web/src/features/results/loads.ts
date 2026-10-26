// The reads a shown result needs, one promise per key for `use`: its manifest, then the array its view draws. Kept out
// of the lazy ResultPanel chunk: the shell, the history, a run and the session start them before the chunk has loaded.
import { engine } from "../../app/recordings";
import type { ResultDocument } from "../../core/types";
import type { ResultTile } from "../../render/resultPyramid";
import { type ShownResult, useStore } from "../../store/store";

export type Loaded<T> = { ok: T } | { error: string };

export const loads = new Map<string, Promise<Loaded<unknown>>>();

/**
 * One promise per key, for `use`, which needs the same promise on every render: a new one would suspend the view
 * again. It settles once, a failure as its message, and a failure stays until Try again drops it. Settled, the promise
 * carries its value as React's `use` reads it, which then returns it without suspending.
 */
export function load<T>(key: string, make: () => Promise<T>): Promise<Loaded<T>> {
  let found = loads.get(key);
  if (!found) {
    const made = make().then(
      (ok): Loaded<T> => ({ ok }),
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
    );
    void made.then((value) => Object.assign(made, { status: "fulfilled", value }));
    found = made;
    loads.set(key, found);
  }
  return found as Promise<Loaded<T>>;
}

export const manifestKey = (id: string) => `${id}/manifest`;
export const manifestOf = (id: string) => load(manifestKey(id), () => engine.resultManifest(id));
export const arrayKey = (id: string, variant: string, array: ResultTile["array"]) =>
  `${id}/${variant}/${array}`;
export const arrayOf = (id: string, variant: string, array: ResultTile["array"]) =>
  load(arrayKey(id, variant, array), () => engine.resultArray(id, variant, array));

/** The variant and the array the view of `manifest` draws for what `shown` picked. */
export function pick(manifest: ResultDocument, shown: ShownResult | null | undefined) {
  const variant = manifest.variants.find((v) => v.id === shown?.variant) ?? manifest.variants[0];
  const hasFitError = variant.arrays?.includes(`${variant.id}/fit_error.npy`) ?? false;
  const array: ResultTile["array"] = shown?.array === "fit_error" && hasFitError ? "fit_error" : "q";
  return { variant, hasFitError, array };
}

/** The result panel's chunk; a chunk that does not load is reported where the panel renders (Shell.tsx). */
export const preloadPanel = () => void import("./ResultPanel").catch(() => {});

/** The results a pointer or the keyboard pointed at in the history, the latest last; at most `INTENDED`. */
const intended: string[] = [];
const INTENDED = 3;

/**
 * Bounds the cache: the reads of the shown result stay, and of the results the other tabs show again when selected,
 * and the manifests of the results last pointed at; the rest goes, to be read again when it is shown.
 */
function evict() {
  const { shownResult, tabs } = useStore.getState();
  const kept = new Set([shownResult?.id, ...tabs.map((tab) => tab.saved?.shownResult?.id)]);
  for (const key of loads.keys()) {
    const id = key.slice(0, key.indexOf("/"));
    if (!kept.has(id) && !(key === manifestKey(id) && intended.includes(id))) loads.delete(key);
  }
}

/** Reads the manifest of `id`; a failure while the result is not shown is dropped, to be read again when it is. */
function readManifest(id: string) {
  return manifestOf(id).then((manifest) => {
    if ("error" in manifest && useStore.getState().shownResult?.id !== id) loads.delete(manifestKey(id));
    return manifest;
  });
}

/**
 * A history row pointed at or focused: the panel's chunk and the manifest load, which the IO worker reads beside its
 * queue. The arrays wait for the click, as a pointer passes over rows it does not open.
 */
export function prefetch(id: string) {
  preloadPanel();
  const at = intended.indexOf(id);
  if (at >= 0) intended.splice(at, 1);
  intended.push(id);
  if (intended.length > INTENDED) intended.shift();
  evict();
  void readManifest(id);
}

/**
 * Starts what showing result `id` takes: the panel's chunk, the manifest, then the array the view opens on. A read
 * that fails while the result is not shown is dropped: opening it reads again, as it would without the preload.
 */
export function preload(id: string) {
  preloadPanel();
  evict();
  const shown = () => {
    const { shownResult } = useStore.getState();
    return shownResult?.id === id ? shownResult : null;
  };
  void readManifest(id).then((manifest) => {
    if ("error" in manifest) return;
    const { variant, array } = pick(manifest.ok, shown());
    void arrayOf(id, variant.id, array).then((loaded) => {
      if ("error" in loaded && !shown()) loads.delete(arrayKey(id, variant.id, array));
    });
  });
}
