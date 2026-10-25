import type { DevEngine } from "../src/core/engine";
import type { SyntheticSpec } from "../src/core/synthetic";
import type { useStore } from "../src/store/store";

declare global {
  interface Window {
    /** The test hook main.tsx installs in dev and e2e builds. */
    __ddalab: {
      engine: DevEngine;
      store: typeof useStore;
      /** Opens a synthetic recording as the UI opens files; resolves with its id. */
      openSynthetic(spec: SyntheticSpec): Promise<string>;
    };
  }
}
