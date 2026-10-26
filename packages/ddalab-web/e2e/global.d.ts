import type { DevEngine, RecordingInput } from "../src/core/engine";
import type { SyntheticSpec } from "../src/core/synthetic";
import type { heatmapProbe } from "../src/features/results/probe";
import type { viewerProbe } from "../src/features/viewer/probe";
import type { useStore } from "../src/store/store";

declare global {
  interface Window {
    /** The test hook main.tsx installs in dev and e2e builds. */
    __ddalab: {
      engine: DevEngine;
      store: typeof useStore;
      /** Opens a synthetic recording as the UI opens files; resolves with its id. */
      openSynthetic(spec: SyntheticSpec): Promise<string>;
      /** Opens any input (a URL a test serves, say) as the UI opens files; resolves with its id. */
      open(input: RecordingInput): Promise<string>;
      /** The waveform's last frame, its pixels and frame times. */
      viewer: typeof viewerProbe;
      /** The result heatmap's last frame and pixels, and the row plot's points. */
      results: typeof heatmapProbe;
      /** A write of the open tabs that resolves once it is in IndexedDB. */
      tabs: { flush(): Promise<void> };
    };
  }
}
