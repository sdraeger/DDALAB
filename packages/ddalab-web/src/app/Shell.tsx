// The workspace: the command bar over the library rail, the plots and the inspector.
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import PanelLeft from "lucide-react/dist/esm/icons/panel-left.mjs";
import PanelRight from "lucide-react/dist/esm/icons/panel-right.mjs";
import Ruler from "lucide-react/dist/esm/icons/ruler.mjs";
import {
  Activity,
  type ButtonHTMLAttributes,
  lazy,
  type ReactElement,
  Suspense,
  useSyncExternalStore,
} from "react";
import { RunButton } from "../features/analysis/RunBar";
import { ResultBoundary } from "../features/history/ResultBoundary";
import { Inspector } from "../features/inspector/Inspector";
import { LibraryRail } from "../features/library/LibraryRail";
import { preload } from "../features/results/loads";
import { useViewerKeys } from "../features/viewer/useViewerKeys";
import { activeRecording, openResult, setTheme, togglePanel, useStore } from "../store/store";
import controls from "../styles/controls.module.css";
import styles from "./Shell.module.css";
import { lazyPart } from "./viewerChunk";

const Calibration = lazy(() => import("../features/settings/Calibration"));
const ResultPanel = lazy(() => import("../features/results/ResultPanel"));
const ViewControls = lazyPart(
  (viewer) => viewer.ViewControls,
  () => null,
);
const Plots = lazyPart((viewer) => viewer.Plots, ViewerMissing);

export function Shell() {
  const { library, inspector } = useStore((s) => s.panels);
  const id = useStore((s) => s.activeRecordingId);
  const resultShown = useStore((s) => s.shownResult !== null);
  useViewerKeys();
  return (
    <Tooltip.Provider delay={400}>
      <div
        className={styles.shell}
        data-library={library ? "open" : "closed"}
        data-inspector={inspector ? "open" : "closed"}
      >
        <header className={styles.bar}>
          <IconButton label="Library" aria-pressed={library} onClick={() => togglePanel("library")}>
            <PanelLeft aria-hidden />
          </IconButton>
          <span className={styles.wordmark}>DDALAB</span>
          <RecordingName />
          <span className={styles.grow} />
          {id && (
            <Suspense fallback={null}>
              <ViewControls />
            </Suspense>
          )}
          <span className={styles.grow} />
          {id && (
            <Suspense fallback={null}>
              <RunButton recordingId={id} status={!inspector} />
            </Suspense>
          )}
          <DisplaySettings />
          <IconButton label="Inspector" aria-pressed={inspector} onClick={() => togglePanel("inspector")}>
            <PanelRight aria-hidden />
          </IconButton>
          <ThemeToggle />
        </header>
        <aside className={styles.library} aria-label="Library">
          <LibraryRail />
        </aside>
        <main className={styles.center}>
          {id ? (
            <>
              <Suspense fallback={null}>
                <Plots id={id} />
              </Suspense>
              <ShownResult recordingId={id} />
            </>
          ) : resultShown ? (
            <ShownResult recordingId={null} />
          ) : (
            <p className={styles.empty}>
              Open a recording from the library, or drop its files or folder anywhere in this window.
            </p>
          )}
        </main>
        <aside className={styles.inspector}>
          {/* Closed, the inspector keeps its state and stops rendering; its effects (the run bar's plan) stop too. */}
          <Activity mode={inspector ? "visible" : "hidden"}>
            <Inspector />
          </Activity>
        </aside>
      </div>
      <p className={styles.narrow}>DDALAB needs a window at least 768 pixels wide.</p>
    </Tooltip.Provider>
  );
}

/**
 * The shown result under the waveform, when it came from the active recording: it shares its time axis. With no
 * recording active (`recordingId` null) it shows alone. One panel shows each result in turn and reuses its canvas and
 * WebGL context. The boundary sits outside the lazy chunk: a chunk that no longer loads (a tab opened before a
 * deploy) or a view that throws leaves a message with a way out.
 */
function ShownResult({ recordingId }: { recordingId: string | null }) {
  const id = useStore((s) => s.shownResult?.id);
  const ours = useStore(
    (s) => recordingId === null || s.shownResult?.fingerprint === s.recordings[recordingId]?.fingerprint,
  );
  if (!id || !ours) return null;
  // The chunk, the manifest and the array load side by side; from inside the chunk they would load one after another.
  preload(id);
  const actions = (
    <>
      <button type="button" className={controls.quiet} onClick={() => location.reload()}>
        Reload
      </button>
      <button type="button" className={controls.quiet} onClick={() => openResult(null)}>
        Close the result
      </button>
    </>
  );
  return (
    <ResultBoundary key={id} what="This result" action={actions}>
      <Suspense fallback={null}>
        <ResultPanel recordingId={recordingId} resultId={id} />
      </Suspense>
    </ResultBoundary>
  );
}

function ViewerMissing() {
  return <p className={styles.empty}>The viewer did not load. Reload the page to see the recording.</p>;
}

/** An icon-only button: its label is its accessible name and its tooltip. */
export function IconButton({
  label,
  render,
  ...props
}: { label: string; render?: ReactElement } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger aria-label={label} className={controls.iconButton} render={render} {...props} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className={controls.tooltip}>{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function RecordingName() {
  const name = useStore((s) => activeRecording(s)?.info.input_files[0]);
  return name ? (
    <span className={styles.name} title={name}>
      {name}
    </span>
  ) : null;
}

function DisplaySettings() {
  return (
    <Popover.Root>
      <IconButton label="Display calibration" render={<Popover.Trigger />}>
        <Ruler aria-hidden />
      </IconButton>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup className={controls.panel}>
            <Suspense fallback={null}>
              <Calibration />
            </Suspense>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const darkQuery = () => matchMedia("(prefers-color-scheme: dark)");
const subscribeToScheme = (onChange: () => void) => {
  const query = darkQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** Follows the system until pressed; the pick is remembered (theme.ts). */
function ThemeToggle() {
  const picked = useStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeToScheme, () => darkQuery().matches);
  const dark = (picked ?? (systemDark ? "dark" : "light")) === "dark";
  return (
    <IconButton label="Dark theme" aria-pressed={dark} onClick={() => setTheme(dark ? "light" : "dark")}>
      <Moon aria-hidden />
    </IconButton>
  );
}
