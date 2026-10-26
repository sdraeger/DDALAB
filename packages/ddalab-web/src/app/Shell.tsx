// The workspace: the command bar over the library rail, the plots and the inspector.
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import Info from "lucide-react/dist/esm/icons/info.mjs";
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
import { useAnnotationKeys } from "../features/annotations/Annotate";
import { ResultBoundary } from "../features/history/ResultBoundary";
import { Inspector } from "../features/inspector/Inspector";
import { LibraryRail } from "../features/library/LibraryRail";
import { preload } from "../features/results/loads";
import { LocalData } from "../features/settings/LocalData";
import { DetachedNote, TabPanel, TabStrip } from "../features/tabs/TabStrip";
import { useViewerKeys } from "../features/viewer/useViewerKeys";
import { activeRecording, openResult, setTheme, togglePanel, useStore } from "../store/store";
import { shortNames } from "../store/tabs";
import controls from "../styles/controls.module.css";
import { Logo } from "./Logo";
import styles from "./Shell.module.css";
import { lazyPart } from "./viewerChunk";
import { inTransition } from "./viewTransition";

const loadCalibration = () => import("../features/settings/Calibration");
const Calibration = lazy(loadCalibration);
const loadAbout = () => import("../features/settings/About");
const About = lazy(loadAbout);
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
  // With no recording active, a selected tab is a detached one.
  const activeTab = useStore((s) => s.activeTab);
  useViewerKeys();
  useAnnotationKeys();
  return (
    <Tooltip.Provider delay={400}>
      <div
        className={styles.shell}
        data-library={library ? "open" : "closed"}
        data-inspector={inspector ? "open" : "closed"}
      >
        <header className={styles.bar}>
          <IconButton
            label="Library"
            aria-pressed={library}
            onClick={() => inTransition(() => togglePanel("library"))}
          >
            <PanelLeft aria-hidden />
          </IconButton>
          <span className={styles.brand}>
            <Logo />
            <h1 className={styles.wordmark}>DDALAB</h1>
          </span>
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
          <PanelButton label="Display calibration" icon={<Ruler aria-hidden />} preload={loadCalibration}>
            <Calibration />
          </PanelButton>
          <IconButton
            label="Inspector"
            aria-pressed={inspector}
            onClick={() => inTransition(() => togglePanel("inspector"))}
          >
            <PanelRight aria-hidden />
          </IconButton>
          <LocalData />
          <ThemeToggle />
          <PanelButton label="About DDALAB" icon={<Info aria-hidden />} preload={loadAbout}>
            <About />
          </PanelButton>
        </header>
        <aside className={styles.library} aria-label="Library">
          <LibraryRail />
        </aside>
        <main className={styles.center}>
          <TabStrip />
          <TabPanel>
            {id ? (
              <>
                <Suspense fallback={null}>
                  <Plots id={id} />
                </Suspense>
                <ShownResult recordingId={id} />
              </>
            ) : activeTab ? (
              <>
                <DetachedNote fingerprint={activeTab} brief={resultShown} />
                {resultShown && <ShownResult recordingId={null} />}
              </>
            ) : resultShown ? (
              <ShownResult recordingId={null} />
            ) : (
              <p className={styles.empty} data-appear>
                Open a recording from the library, or drop its files or folder anywhere in this window.
              </p>
            )}
          </TabPanel>
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
      <button type="button" className={controls.quiet} onClick={() => inTransition(() => openResult(null))}>
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

/** The active recording by the label its tab shows, its full name in the tooltip. */
function RecordingName() {
  const name = useStore((s) => activeRecording(s)?.info.input_files[0]);
  const label = useStore((s) => {
    const i = s.tabs.findIndex((t) => t.fingerprint === s.activeTab);
    return i < 0 ? undefined : shortNames(s.tabs.map((t) => t.name))[i];
  });
  return name ? (
    <span className={styles.name} title={name} data-appear>
      {label ?? name}
    </span>
  ) : null;
}

/** An icon button of the command bar that opens a panel; the panel's chunk loads on pointer or focus. */
function PanelButton(props: {
  label: string;
  icon: ReactElement;
  preload: () => Promise<unknown>;
  children: ReactElement;
}) {
  // A chunk that fails to preload stays quiet: opening the panel loads it again and reports a failure.
  const preload = () => void props.preload().catch(() => {});
  return (
    <Popover.Root>
      <IconButton label={props.label} render={<Popover.Trigger />} onPointerEnter={preload} onFocus={preload}>
        {props.icon}
      </IconButton>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup className={controls.panel}>
            <Suspense fallback={null}>{props.children}</Suspense>
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

/** Follows the system until pressed; the pick is remembered (theme.ts). The page crossfades to the new theme. */
function ThemeToggle() {
  const picked = useStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeToScheme, () => darkQuery().matches);
  const dark = (picked ?? (systemDark ? "dark" : "light")) === "dark";
  return (
    <IconButton
      label="Dark theme"
      aria-pressed={dark}
      onClick={() => inTransition(() => setTheme(dark ? "light" : "dark"))}
    >
      <Moon aria-hidden />
    </IconButton>
  );
}
