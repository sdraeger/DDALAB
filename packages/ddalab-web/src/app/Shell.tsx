// The workspace: the command bar over the library rail, the plots and the inspector. On a phone the library, the
// waveform and the shown result take the screen one at a time, chosen in a bar at the bottom, and the inspector
// covers them when it is open.
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import AudioWaveform from "lucide-react/dist/esm/icons/audio-waveform.mjs";
import ChartColumn from "lucide-react/dist/esm/icons/chart-column.mjs";
import Info from "lucide-react/dist/esm/icons/info.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
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
  useEffect,
  useSyncExternalStore,
} from "react";
import { RunButton } from "../features/analysis/RunBar";
import { useAnnotationKeys } from "../features/annotations/Annotate";
import { ResultBoundary } from "../features/history/ResultBoundary";
import { Inspector } from "../features/inspector/Inspector";
import { BatchAnnouncer, BatchStatus } from "../features/library/BatchStatus";
import { LibraryRail } from "../features/library/LibraryRail";
import { preload } from "../features/results/loads";
import { LocalData } from "../features/settings/LocalData";
import { DetachedNote, TabPanel, TabStrip } from "../features/tabs/TabStrip";
import { useViewerKeys } from "../features/viewer/useViewerKeys";
import {
  activeRecording,
  openResult,
  type PhoneView,
  setTheme,
  showPhoneView,
  togglePanel,
  togglePhoneInspector,
  useStore,
} from "../store/store";
import { shortNames } from "../store/tabs";
import controls from "../styles/controls.module.css";
import menu from "./AppMenu.module.css";
import { Logo } from "./Logo";
import { usePhone } from "./phone";
import styles from "./Shell.module.css";
import { UpdateNotice } from "./UpdateNotice";
import { lazyPart } from "./viewerChunk";
import { inTransition } from "./viewTransition";

const loadCalibration = () => import("../features/settings/Calibration");
const Calibration = lazy(loadCalibration);
const loadAbout = () => import("../features/settings/About");
const About = lazy(loadAbout);
const ResultPanel = lazy(() => import("../features/results/ResultPanel"));
// A chunk that does not load leaves the mark and wordmark without their menu; the bar's own controls stay.
const AppMenu = lazy(() => import("./AppMenu").catch(() => ({ default: Brand })));

/** The popovers of the bar's Calibration and About buttons, which the application menu opens too, by trigger id. */
export const calibrationPanel = Popover.createHandle();
export const aboutPanel = Popover.createHandle();
export const CALIBRATION_TRIGGER = "calibration";
export const ABOUT_TRIGGER = "about";

/** Shows or hides a side panel, crossfading the layout: the bar's toggles and the View menu. */
export const toggle = (panel: "library" | "inspector") => inTransition(() => togglePanel(panel));

const ViewControls = lazyPart(
  (viewer) => viewer.ViewControls,
  () => null,
);
const Plots = lazyPart((viewer) => viewer.Plots, ViewerMissing);

export function Shell() {
  const panels = useStore((s) => s.panels);
  const phoneState = useStore((s) => s.phone);
  const phone = usePhone();
  // A phone has an inspector state of its own: the desktop's open inspector would cover every view.
  const library = panels.library;
  const inspector = phone ? phoneState.inspector : panels.inspector;
  const id = useStore((s) => s.activeRecordingId);
  const resultId = useStore((s) => s.shownResult?.id);
  const resultShown = resultId !== undefined;
  // With no recording active, a selected tab is a detached one.
  const activeTab = useStore((s) => s.activeTab);
  // A batch's status takes the run-status slot while it runs.
  const batching = useStore((s) => s.batch?.status === "running");
  useViewerKeys();
  useAnnotationKeys();
  // A recording opened goes to the waveform, a result shown to the results; a desktop window ignores the view.
  useEffect(() => {
    if (id) showPhoneView("waveform");
  }, [id]);
  useEffect(() => {
    if (resultId) showPhoneView("results");
  }, [resultId]);
  return (
    <Tooltip.Provider delay={400}>
      <div
        className={styles.shell}
        data-library={library ? "open" : "closed"}
        data-inspector={inspector ? "open" : "closed"}
        data-view={phoneState.view}
      >
        <header className={styles.bar}>
          <span className={styles.wide}>
            <IconButton label="Library" aria-pressed={library} onClick={() => toggle("library")}>
              <PanelLeft aria-hidden />
            </IconButton>
          </span>
          <Suspense fallback={<Brand />}>
            <AppMenu />
          </Suspense>
          <RecordingName />
          <span className={styles.grow} />
          {id && (
            <Suspense fallback={null}>
              <ViewControls />
            </Suspense>
          )}
          <span className={styles.grow} />
          <BatchStatus />
          {id && (
            <Suspense fallback={null}>
              <RunButton recordingId={id} status={!inspector && !batching} />
            </Suspense>
          )}
          {/* On a phone these live in the application menu (View, Help). */}
          <span className={styles.wide}>
            <PanelButton
              label="Display calibration"
              icon={<Ruler aria-hidden />}
              preload={loadCalibration}
              handle={calibrationPanel}
              id={CALIBRATION_TRIGGER}
            >
              <Calibration />
            </PanelButton>
          </span>
          <IconButton
            label="Inspector"
            aria-pressed={inspector}
            onClick={() => (phone ? togglePhoneInspector() : toggle("inspector"))}
          >
            <PanelRight aria-hidden />
          </IconButton>
          <span className={styles.wide}>
            <LocalData />
            <ThemeToggle />
            <PanelButton
              label="About DDALAB"
              icon={<Info aria-hidden />}
              preload={loadAbout}
              handle={aboutPanel}
              id={ABOUT_TRIGGER}
            >
              <About />
            </PanelButton>
          </span>
        </header>
        <BatchAnnouncer />
        {/* On a phone what the inspector or the library covers takes no focus and no screen reader reads it. */}
        <aside className={styles.library} aria-label="Library" inert={phone && inspector}>
          <LibraryRail />
        </aside>
        <main className={styles.center} inert={phone && (inspector || phoneState.view === "library")}>
          <TabStrip />
          <TabPanel>
            {id ? (
              <>
                <div className={styles.waveform}>
                  <Suspense fallback={null}>
                    <Plots id={id} />
                  </Suspense>
                </div>
                <div className={styles.results}>
                  <ShownResult recordingId={id} />
                </div>
              </>
            ) : activeTab ? (
              <>
                <div className={styles.waveform}>
                  <DetachedNote fingerprint={activeTab} brief={resultShown} />
                </div>
                <div className={styles.results}>{resultShown && <ShownResult recordingId={null} />}</div>
              </>
            ) : resultShown ? (
              <div className={styles.results}>
                <ShownResult recordingId={null} />
              </div>
            ) : (
              <p className={`${styles.empty} ${styles.waveform}`} data-appear>
                Open a recording from the library, or drop its files or folder anywhere in this window.
              </p>
            )}
            <NoResult recordingId={id} />
          </TabPanel>
        </main>
        <aside className={styles.inspector}>
          {/* Closed, the inspector keeps its state and stops rendering; its effects (the run bar's plan) stop too. */}
          <Activity mode={inspector ? "visible" : "hidden"}>
            <Inspector />
          </Activity>
        </aside>
        <UpdateNotice />
        <nav className={styles.views} aria-label="Views">
          <ViewButton view="library" label="Library" icon={<Library aria-hidden />} />
          <ViewButton view="waveform" label="Waveform" icon={<AudioWaveform aria-hidden />} />
          <ViewButton view="results" label="Results" icon={<ChartColumn aria-hidden />} />
        </nav>
      </div>
    </Tooltip.Provider>
  );
}

/** A button of the phone's view bar; the view shows in a crossfade and closes the inspector. */
function ViewButton({ view, label, icon }: { view: PhoneView; label: string; icon: ReactElement }) {
  const current = useStore((s) => s.phone.view === view);
  return (
    <button
      type="button"
      className={styles.viewButton}
      aria-current={current ? "page" : undefined}
      onClick={() => inTransition(() => showPhoneView(view))}
    >
      {icon}
      {label}
    </button>
  );
}

/** The Results view on a phone with no result of the active recording to show. */
function NoResult({ recordingId }: { recordingId: string | null }) {
  const shown = useStore(
    (s) =>
      s.shownResult !== null &&
      (recordingId === null || s.shownResult.fingerprint === s.recordings[recordingId]?.fingerprint),
  );
  if (shown) return null;
  return (
    <p className={`${styles.empty} ${styles.noResult}`}>
      Run DDA from the inspector, or pick a result in the library’s history, to see it here.
    </p>
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

/** The mark and wordmark as the application menu draws its trigger (AppMenu.tsx), while its chunk loads. */
function Brand() {
  return (
    <h1 className={menu.brand}>
      <span className={menu.trigger}>
        <Logo />
        <span className={menu.wordmark}>DDALAB</span>
      </span>
    </h1>
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

/** The active recording by the label its tab shows, short of its modality suffix; its full name in the tooltip. */
function RecordingName() {
  const name = useStore((s) => activeRecording(s)?.info.input_files[0]);
  const label = useStore((s) => {
    const i = s.tabs.findIndex((t) => t.fingerprint === s.activeTab);
    return i < 0 ? undefined : shortNames(s.tabs.map((t) => t.name))[i];
  });
  if (!name) return null;
  // A BIDS name gives up its modality suffix and elides in the middle: its last entity (run-01) stays in view.
  const bids = /^(.*_)([a-z0-9]+-[a-z0-9]+)_[a-z0-9]+\.[a-z0-9.]+$/i.exec(label ?? name);
  return (
    <span className={styles.name} title={name} data-appear>
      <span className={styles.nameHead}>{bids ? bids[1] : (label ?? name)}</span>
      {bids && <span className={styles.nameTail}>{bids[2]}</span>}
    </span>
  );
}

/**
 * An icon button of the command bar that opens a panel; the panel's chunk loads on pointer or focus. The application
 * menu opens it too, through `handle` and the button's `id`.
 */
function PanelButton(props: {
  label: string;
  icon: ReactElement;
  preload: () => Promise<unknown>;
  handle: ReturnType<typeof Popover.createHandle>;
  id: string;
  children: ReactElement;
}) {
  // A chunk that fails to preload stays quiet: opening the panel loads it again and reports a failure.
  const preload = () => void props.preload().catch(() => {});
  return (
    <Popover.Root handle={props.handle}>
      <IconButton
        label={props.label}
        render={<Popover.Trigger />}
        id={props.id}
        onPointerEnter={preload}
        onFocus={preload}
      >
        {props.icon}
      </IconButton>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          {/* Named by its button; a panel with a Popover.Title (About) is named by that instead. */}
          <Popover.Popup className={controls.panel} aria-label={props.label}>
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
