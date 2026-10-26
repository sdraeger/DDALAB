// The viewer's lazy chunk (Viewer.tsx). main.tsx loads it once the shell has painted, and an open waits for it if it is
// not in yet (recordings.ts): the recording's first render has it in place.
import { type ComponentType, lazy } from "react";
import type * as Viewer from "./Viewer";

let loaded: typeof Viewer | undefined;

export const loadViewer = () => import("./Viewer").then((module) => (loaded = module));
export const viewerLoaded = () => loaded !== undefined;

/**
 * A part of the chunk for React.lazy, `missing` when the chunk does not load. A chunk already loaded comes at once,
 * through a thenable that answers synchronously: a lazy component that suspends on its first render shows only after
 * React's 300 ms throttle on revealing content, which would hold back the first waveform.
 */
export function lazyPart<P extends object>(
  pick: (module: typeof Viewer) => ComponentType<P>,
  missing: ComponentType<P>,
) {
  type Part = { default: ComponentType<P> };
  return lazy((): Promise<Part> => {
    const found = loaded;
    // biome-ignore lint/suspicious/noThenProperty: React.lazy reads a thenable that answers at once without suspending
    if (found) return { then: (show: (part: Part) => void) => show({ default: pick(found) }) } as never;
    return loadViewer().then(
      (module) => ({ default: pick(module) }),
      () => ({ default: missing }),
    );
  });
}
