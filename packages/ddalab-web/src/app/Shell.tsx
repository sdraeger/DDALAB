// The workspace: the command bar over the library rail, the plots and the inspector. On a phone the library, the
// waveform and the shown result take the screen one at a time, chosen in a bar at the bottom, and the inspector
// covers them when it is open.
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right.mjs";
import AudioWaveform from "lucide-react/dist/esm/icons/audio-waveform.mjs";
import ChartColumn from "lucide-react/dist/esm/icons/chart-column.mjs";
import Columns2 from "lucide-react/dist/esm/icons/columns-2.mjs";
import Info from "lucide-react/dist/esm/icons/info.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import PanelLeft from "lucide-react/dist/esm/icons/panel-left.mjs";
import PanelRight from "lucide-react/dist/esm/icons/panel-right.mjs";
import Rows2 from "lucide-react/dist/esm/icons/rows-2.mjs";
import Ruler from "lucide-react/dist/esm/icons/ruler.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import {
  Activity,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  lazy,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clampAndSnap,
  type DockZone,
  INSPECTOR_STOPS,
  LIBRARY_STOPS,
  resolveDropZone,
  snapRatio,
} from "../core/layoutSnap";
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
  closeSplitRecording,
  openResult,
  type PhoneView,
  setPanelDrag,
  setResultDock,
  setSplitRecording,
  setTheme,
  showPhoneView,
  swapSplitRecordings,
  togglePanel,
  togglePhoneInspector,
  useStore,
} from "../store/store";
import { idOf, selectTab, shortNames } from "../store/tabs";
import controls from "../styles/controls.module.css";
import { useMedia, usePhone } from "../styles/media";
import menu from "./AppMenu.module.css";
import { Logo } from "./Logo";
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

const LIB_DEFAULT = 288;
const LIB_MIN = 220;
const LIB_MAX = 440;
const INSP_DEFAULT = 348;
const INSP_MIN = 280;
const INSP_MAX = 520;

const clampWidth = (v: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, v)));

function readWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
  } catch {
    return fallback;
  }
}

function saveWidth(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

export function Shell() {
  const panels = useStore((s) => s.panels);
  const phoneState = useStore((s) => s.phone);
  const phone = usePhone();
  const [libraryWidth, setLibraryWidth] = useState(() =>
    readWidth("ddalab.libraryWidth", LIB_DEFAULT, LIB_MIN, LIB_MAX),
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    readWidth("ddalab.inspectorWidth", INSP_DEFAULT, INSP_MIN, INSP_MAX),
  );
  const [sideBadge, setSideBadge] = useState<{
    side: "library" | "inspector";
    label: string;
    snapped: boolean;
  } | null>(null);
  // A phone has an inspector state of its own: the desktop's open inspector would cover every view.
  const library = panels.library;
  const inspector = phone ? phoneState.inspector : panels.inspector;
  const id = useStore((s) => s.activeRecordingId);
  const resultShown = useStore((s) => s.shownResult !== null);
  // With no recording active, a selected tab is a detached one.
  const activeTab = useStore((s) => s.activeTab);
  // A batch's status takes the run-status slot while it runs.
  const batching = useStore((s) => s.batch?.status === "running");
  useViewerKeys();
  useAnnotationKeys();

  const startResize = (event: ReactPointerEvent<HTMLHRElement>, side: "library" | "inspector") => {
    const el = event.currentTarget;
    const x0 = event.clientX;
    const startW = side === "library" ? libraryWidth : inspectorWidth;
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      if (side === "library") {
        const { value, snapped } = clampAndSnap(startW + dx, LIB_MIN, LIB_MAX, LIBRARY_STOPS, 10);
        const next = Math.round(value);
        setLibraryWidth(next);
        saveWidth("ddalab.libraryWidth", next);
        setSideBadge({ side, label: `${next} px`, snapped: snapped !== null });
      } else {
        const { value, snapped } = clampAndSnap(startW - dx, INSP_MIN, INSP_MAX, INSPECTOR_STOPS, 10);
        const next = Math.round(value);
        setInspectorWidth(next);
        saveWidth("ddalab.inspectorWidth", next);
        setSideBadge({ side, label: `${next} px`, snapped: snapped !== null });
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener(
      "lostpointercapture",
      () => {
        el.removeEventListener("pointermove", move);
        setSideBadge(null);
      },
      { once: true },
    );
  };

  const stepResize = (event: KeyboardEvent<HTMLHRElement>, side: "library" | "inspector") => {
    const dir = { ArrowRight: 16, ArrowLeft: -16 }[event.key];
    if (dir === undefined) return;
    event.preventDefault();
    if (side === "library") {
      const next = clampWidth(libraryWidth + dir, LIB_MIN, LIB_MAX);
      setLibraryWidth(next);
      saveWidth("ddalab.libraryWidth", next);
    } else {
      const next = clampWidth(inspectorWidth - dir, INSP_MIN, INSP_MAX);
      setInspectorWidth(next);
      saveWidth("ddalab.inspectorWidth", next);
    }
  };

  const shellStyle = {
    "--library-open-width": `${libraryWidth}px`,
    "--inspector-open-width": `${inspectorWidth}px`,
  } as CSSProperties;

  return (
    <Tooltip.Provider delay={400}>
      <PhoneViews />
      <div
        className={styles.shell}
        style={shellStyle}
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
          {id && !inspector && (
            <Suspense fallback={null}>
              <RunButton recordingId={id} status={!batching} />
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
          {sideBadge?.side === "library" && (
            <span className={styles.snapBadge} data-snapped={sideBadge.snapped || undefined} aria-hidden>
              {sideBadge.label}
            </span>
          )}
          <hr
            className={styles.resizeLeft}
            aria-orientation="vertical"
            aria-label="Library width"
            aria-valuemin={LIB_MIN}
            aria-valuemax={LIB_MAX}
            aria-valuenow={libraryWidth}
            tabIndex={0}
            data-own-keys
            title="Drag to resize library (snaps to presets, double-click to reset)"
            onPointerDown={(e) => startResize(e, "library")}
            onKeyDown={(e) => stepResize(e, "library")}
            onDoubleClick={() => {
              setLibraryWidth(LIB_DEFAULT);
              saveWidth("ddalab.libraryWidth", LIB_DEFAULT);
            }}
          />
        </aside>
        <main className={styles.center} inert={phone && (inspector || phoneState.view === "library")}>
          <TabStrip />
          <TabPanel>
            <WorkspaceCanvas id={id} activeTab={activeTab} resultShown={resultShown} />
            <NoResult recordingId={id} />
          </TabPanel>
        </main>
        <aside className={styles.inspector}>
          {sideBadge?.side === "inspector" && (
            <span
              className={`${styles.snapBadge} ${styles.snapBadgeLeft}`}
              data-snapped={sideBadge.snapped || undefined}
              aria-hidden
            >
              {sideBadge.label}
            </span>
          )}
          <hr
            className={styles.resizeRight}
            aria-orientation="vertical"
            aria-label="Inspector width"
            aria-valuemin={INSP_MIN}
            aria-valuemax={INSP_MAX}
            aria-valuenow={inspectorWidth}
            tabIndex={0}
            data-own-keys
            title="Drag to resize inspector (snaps to presets, double-click to reset)"
            onPointerDown={(e) => startResize(e, "inspector")}
            onKeyDown={(e) => stepResize(e, "inspector")}
            onDoubleClick={() => {
              setInspectorWidth(INSP_DEFAULT);
              saveWidth("ddalab.inspectorWidth", INSP_DEFAULT);
            }}
          />
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

/**
 * The dockable, split-capable workspace canvas inside TabPanel: renders primary (and optional split secondary) open
 * recordings alongside the dockable DDA result panel, plus the magnetic drop-zone overlay during tab/panel drags.
 */
function WorkspaceCanvas(props: { id: string | null; activeTab: string | null; resultShown: boolean }) {
  const { id, activeTab, resultShown } = props;
  const resultDock = useStore((s) => s.resultDock);
  const split = useStore((s) => s.splitRecording);
  const panelDrag = useStore((s) => s.panelDrag);
  const recordings = useStore((s) => s.recordings);
  const tabs = useStore((s) => s.tabs);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const [dropZone, setDropZone] = useState<DockZone | null>(null);
  const [splitBadge, setSplitBadge] = useState<{ label: string; snapped: boolean } | null>(null);

  // Track pointer over workspace during an active tab or result drag and commit the snap on release.
  useEffect(() => {
    if (!panelDrag) {
      setDropZone(null);
      return;
    }
    const allowed: readonly DockZone[] =
      panelDrag.kind === "result"
        ? ["bottom", "top", "right", "left"]
        : ["left", "right", "top", "bottom", "center"];
    let latestZone: DockZone = panelDrag.kind === "result" ? useStore.getState().resultDock : "right";
    setDropZone(latestZone);

    const onMove = (event: PointerEvent) => {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      latestZone = resolveDropZone(event.clientX, event.clientY, rect, allowed);
      setDropZone(latestZone);
    };
    const onUp = () => {
      const currentDrag = useStore.getState().panelDrag;
      setPanelDrag(null);
      setDropZone(null);
      if (!currentDrag) return;
      if (currentDrag.kind === "result") {
        if (latestZone !== "center") {
          const target = latestZone;
          inTransition(() => setResultDock(target));
        }
        return;
      }
      // Tab dropped onto the workspace canvas: snap into a split pane or focus it.
      const state = useStore.getState();
      const draggedFp = currentDrag.fingerprint;
      if (latestZone === "center" || state.activeTab === null) {
        selectTab(draggedFp);
        closeSplitRecording();
        return;
      }
      const direction = latestZone === "left" || latestZone === "right" ? "horizontal" : "vertical";
      if (draggedFp === state.activeTab) {
        // Dragged the active tab: if another open recording exists, split with it cleanly.
        const other = state.tabs.find(
          (t) => t.fingerprint !== draggedFp && idOf(t.fingerprint, state.recordings) !== undefined,
        );
        if (other) {
          inTransition(() => setSplitRecording({ fingerprint: other.fingerprint, direction, ratio: 0.5 }));
        }
        return;
      }
      if (latestZone === "left" || latestZone === "top") {
        const previousPrimary = state.activeTab;
        inTransition(() => {
          selectTab(draggedFp);
          setSplitRecording({ fingerprint: previousPrimary, direction, ratio: 0.5 });
        });
      } else {
        inTransition(() => setSplitRecording({ fingerprint: draggedFp, direction, ratio: 0.5 }));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [panelDrag]);

  const splitId = split ? (idOf(split.fingerprint, recordings) ?? null) : null;
  const activeSplit = id !== null && split !== null && splitId !== null && splitId !== id ? split : null;

  const startSplitResize = (event: ReactPointerEvent<HTMLHRElement>) => {
    if (!activeSplit) return;
    const el = event.currentTarget;
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const isH = activeSplit.direction === "horizontal";
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const raw = isH ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      const { value, snapped } = snapRatio(raw);
      setSplitRecording({ ...activeSplit, ratio: value });
      setSplitBadge({ label: `${Math.round(value * 100)}%`, snapped: snapped !== null });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener(
      "lostpointercapture",
      () => {
        el.removeEventListener("pointermove", move);
        setSplitBadge(null);
      },
      { once: true },
    );
  };

  const stepSplitResize = (event: KeyboardEvent<HTMLHRElement>) => {
    if (!activeSplit) return;
    const by =
      activeSplit.direction === "horizontal"
        ? { ArrowRight: 0.05, ArrowLeft: -0.05 }[event.key]
        : { ArrowDown: 0.05, ArrowUp: -0.05 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    setSplitRecording({ ...activeSplit, ratio: Math.max(0.25, Math.min(0.75, activeSplit.ratio + by)) });
  };

  const dropLabel =
    panelDrag && dropZone
      ? panelDrag.kind === "result"
        ? `Dock DDA result ${dropZone}`
        : dropZone === "center"
          ? `Open ${panelDrag.name}`
          : `Split ${dropZone} · ${panelDrag.name}`
      : "";

  const primaryName =
    tabs.find((t) => t.fingerprint === activeTab)?.name ?? recordings[id ?? ""]?.info.input_files[0];
  const secondaryName = activeSplit
    ? (tabs.find((t) => t.fingerprint === activeSplit.fingerprint)?.name ??
      recordings[splitId ?? ""]?.info.input_files[0])
    : undefined;

  return (
    <div
      ref={workspaceRef}
      className={styles.workspace}
      data-result-dock={resultShown && id ? resultDock : "bottom"}
    >
      {id ? (
        <>
          <div className={styles.waveform}>
            {activeSplit && splitId ? (
              <div ref={splitRef} className={styles.splitContainer} data-dir={activeSplit.direction}>
                <div className={styles.splitPane} data-primary style={{ flex: activeSplit.ratio }}>
                  <div className={styles.splitHeader}>
                    <span className={styles.splitDot} aria-hidden />
                    <span className={styles.splitTitle} title={primaryName}>
                      {primaryName}
                    </span>
                  </div>
                  <Suspense fallback={null}>
                    <Plots id={id} />
                  </Suspense>
                </div>
                <hr
                  aria-orientation={activeSplit.direction === "horizontal" ? "vertical" : "horizontal"}
                  aria-label="Split pane ratio"
                  aria-valuemin={25}
                  aria-valuemax={75}
                  aria-valuenow={Math.round(activeSplit.ratio * 100)}
                  tabIndex={0}
                  data-own-keys
                  className={styles.splitHandle}
                  data-dir={activeSplit.direction}
                  title="Drag to resize split panes (snaps to 33% / 50% / 67%, double-click to reset)"
                  onPointerDown={startSplitResize}
                  onKeyDown={stepSplitResize}
                  onDoubleClick={() => setSplitRecording({ ...activeSplit, ratio: 0.5 })}
                />
                {splitBadge && (
                  <span
                    className={styles.snapBadge}
                    data-snapped={splitBadge.snapped || undefined}
                    aria-hidden
                  >
                    {splitBadge.label}
                  </span>
                )}
                <div className={styles.splitPane} style={{ flex: 1 - activeSplit.ratio }}>
                  <div className={styles.splitHeader}>
                    <button
                      type="button"
                      className={styles.splitFocus}
                      title={`Switch active recording to ${secondaryName}`}
                      onClick={() => swapSplitRecordings()}
                    >
                      {secondaryName}
                    </button>
                    <div className={styles.splitActions}>
                      <button
                        type="button"
                        className={styles.splitAction}
                        aria-label="Swap split panes"
                        title="Swap primary and secondary panes"
                        onClick={() => swapSplitRecordings()}
                      >
                        <ArrowLeftRight aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.splitAction}
                        aria-label={
                          activeSplit.direction === "horizontal"
                            ? "Stack split panes vertically"
                            : "Arrange split panes side by side"
                        }
                        title={
                          activeSplit.direction === "horizontal" ? "Stack vertically" : "Arrange side by side"
                        }
                        onClick={() =>
                          setSplitRecording({
                            ...activeSplit,
                            direction: activeSplit.direction === "horizontal" ? "vertical" : "horizontal",
                          })
                        }
                      >
                        {activeSplit.direction === "horizontal" ? (
                          <Rows2 aria-hidden />
                        ) : (
                          <Columns2 aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        className={styles.splitAction}
                        aria-label="Close split pane"
                        title="Close split pane"
                        onClick={() => closeSplitRecording()}
                      >
                        <X aria-hidden />
                      </button>
                    </div>
                  </div>
                  <Suspense fallback={null}>
                    <Plots id={splitId} />
                  </Suspense>
                </div>
              </div>
            ) : (
              <Suspense fallback={null}>
                <Plots id={id} />
              </Suspense>
            )}
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
      {panelDrag && dropZone && (
        <div className={styles.dropOverlay} aria-hidden>
          <div className={styles.dropPreview} data-zone={dropZone}>
            <span className={styles.dropLabel}>{dropLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * On a phone, a recording opened shows the waveform and a result shown shows the results. A component of its own: what
 * it follows re-renders nothing else, and a desktop window keeps the view as it was.
 */
function PhoneViews() {
  const phone = usePhone();
  const id = useStore((s) => s.activeRecordingId);
  const resultId = useStore((s) => s.shownResult?.id);
  useEffect(() => {
    if (phone && id) showPhoneView("waveform");
  }, [phone, id]);
  useEffect(() => {
    if (phone && resultId) showPhoneView("results");
  }, [phone, resultId]);
  return null;
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

/** Follows the system until pressed; the pick is remembered (theme.ts). The page crossfades to the new theme. */
function ThemeToggle() {
  const picked = useStore((s) => s.theme);
  const systemDark = useMedia("(prefers-color-scheme: dark)");
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
