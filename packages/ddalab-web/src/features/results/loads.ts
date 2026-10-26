// The reads a shown result needs, one promise per key for `use`: its manifest, then the array its view draws. Kept out
// of the lazy ResultPanel chunk: the shell, the history, a run and the session start them before the chunk has loaded.
import { engine } from "../../app/recordings";
import type { ResultDocument } from "../../core/types";
import type { ResultTile } from "../../render/resultPyramid";
import { type ShownResult, useStore } from "../../store/store";

export type Loaded<T> = { ok: T } | { error: string };

export const loads = new Map<string, Promise<Loaded<unknown>>>();

/**
 * One promise per key, for `use`: it settles once, a failure as its message. A failure stays until Try again drops
 * it: asked again on every render, a missing file would be read again on every frame of a pan. Settled, the promise
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

export const manifestOf = (id: string) => load(`${id}/manifest`, () => engine.resultManifest(id));
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

/**
 * Starts what showing result `id` takes: the panel's chunk, the manifest, then the array the view opens on. A read
 * that fails while the result is not shown is dropped: opening it reads again, as it would without the preload.
 */
export function preload(id: string) {
  preloadPanel();
  const shown = () => {
    const { shownResult } = useStore.getState();
    return shownResult?.id === id ? shownResult : null;
  };
  void manifestOf(id).then((manifest) => {
    if ("error" in manifest) {
      if (!shown()) loads.delete(`${id}/manifest`);
      return;
    }
    const { variant, array } = pick(manifest.ok, shown());
    void arrayOf(id, variant.id, array).then((loaded) => {
      if ("error" in loaded && !shown()) loads.delete(arrayKey(id, variant.id, array));
    });
  });
}
