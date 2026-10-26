// The workspace: the command bar over the library rail, the plots and the inspector.
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { Tooltip } from "@base-ui/react/tooltip";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronFirst from "lucide-react/dist/esm/icons/chevron-first.mjs";
import ChevronLast from "lucide-react/dist/esm/icons/chevron-last.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import PanelLeft from "lucide-react/dist/esm/icons/panel-left.mjs";
import PanelRight from "lucide-react/dist/esm/icons/panel-right.mjs";
import Ruler from "lucide-react/dist/esm/icons/ruler.mjs";
import { type ButtonHTMLAttributes, lazy, type ReactElement, Suspense, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { RunButton } from "../features/analysis/RunBar";
import { AnnotateButton, useAnnotationKeys } from "../features/annotations/Annotate";
import { ResultBoundary } from "../features/history/ResultBoundary";
import { Inspector } from "../features/inspector/Inspector";
import { LibraryRail } from "../features/library/LibraryRail";
import { Overview } from "../features/viewer/Overview";
import { useViewerKeys } from "../features/viewer/useViewerKeys";
import { WaveformCanvas } from "../features/viewer/WaveformCanvas";
import {
  activeRecording,
  EPOCHS,
  type Epoch,
  openResult,
  pageBy,
  pageOf,
  pageToEnd,
  pageToStart,
  SENSITIVITIES,
  setEpoch,
  setTheme,
  setTimebase,
  setView,
  timebaseOf,
  togglePanel,
  useStore,
} from "../store/store";
import controls from "../styles/controls.module.css";
import styles from "./Shell.module.css";

const Calibration = lazy(() => import("../features/settings/Calibration"));
const ResultPanel = lazy(() => import("../features/results/ResultPanel"));

const TIMEBASES = [10, 15, 20, 30, 60, 120];

export function Shell() {
  const { library, inspector } = useStore((s) => s.panels);
  const id = useStore((s) => s.activeRecordingId);
  const resultShown = useStore((s) => s.shownResult !== null);
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
          <IconButton label="Library" aria-pressed={library} onClick={() => togglePanel("library")}>
            <PanelLeft aria-hidden />
          </IconButton>
          <span className={styles.wordmark}>DDALAB</span>
          <RecordingName />
          <span className={styles.grow} />
          {id && <ViewControls />}
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
              <Overview key={`overview-${id}`} recordingId={id} />
              <WaveformCanvas key={id} recordingId={id} />
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
          <Inspector />
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

/** An icon-only button: its label is its accessible name and its tooltip. */
function IconButton({
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

/** Paging and the physical scale of the plot. */
function ViewControls() {
  const duration = useStore((s) => activeRecording(s)?.info.duration_s ?? 0);
  const epochS = useStore((s) => s.view.epochS);
  // Whole pages only: they change on paging, not on every pan frame.
  const [page, pages] = useStore(useShallow((s) => pageOf(s.view, duration)));
  const sensitivity = useStore((s) => s.view.sensitivityUvPerMm);
  // Three significant digits: it changes on zoom, not on every pan frame.
  const timebase = useStore((s) => Number(timebaseOf(s.view, s.plotCssWidth).toPrecision(3)));
  return (
    <div className={styles.view}>
      <div className={styles.paging}>
        <IconButton label="First page" onClick={pageToStart}>
          <ChevronFirst aria-hidden />
        </IconButton>
        <IconButton label="Previous page" onClick={() => pageBy(-1)}>
          <ChevronLeft aria-hidden />
        </IconButton>
        <IconButton label="Next page" onClick={() => pageBy(1)}>
          <ChevronRight aria-hidden />
        </IconButton>
        <IconButton label="Last page" onClick={pageToEnd}>
          <ChevronLast aria-hidden />
        </IconButton>
        <span className={styles.page}>
          Page {page} of {pages}
        </span>
      </div>
      <span className={controls.rule} />
      <Choice
        label="Epoch"
        value={epochS}
        items={EPOCHS.map((e) => ({ value: e, label: `${e} s` }))}
        onChange={(e) => setEpoch(e as Epoch)}
      />
      <Choice
        label="Sensitivity"
        value={sensitivity}
        items={SENSITIVITIES.map((s) => ({ value: s, label: `${s} µV/mm` }))}
        onChange={(s) => setView({ sensitivityUvPerMm: s })}
      />
      <Choice
        label="Timebase"
        value={timebase}
        items={TIMEBASES.map((t) => ({ value: t, label: `${t} mm/s` }))}
        onChange={setTimebase}
        format={(t) => `${t} mm/s`}
      />
      <span className={controls.rule} />
      <AnnotateButton />
    </div>
  );
}

/** A labeled select of numbers; `format` shows a value that is not among the items. */
function Choice(props: {
  label: string;
  value: number;
  items: { value: number; label: string }[];
  onChange(value: number): void;
  format?: (value: number) => string;
}) {
  const { format } = props;
  return (
    <Select.Root
      value={props.value}
      items={props.items}
      onValueChange={(value) => value !== null && props.onChange(value as number)}
    >
      <div className={controls.field}>
        <Select.Label className={controls.label}>{props.label}</Select.Label>
        <Select.Trigger className={controls.trigger}>
          <Select.Value>{format ? (value: number) => format(value) : undefined}</Select.Value>
          <Select.Icon>
            <ChevronDown aria-hidden />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className={controls.popup}>
            <Select.List className={controls.list}>
              {props.items.map((item) => (
                <Select.Item key={item.value} value={item.value} className={controls.item}>
                  <Select.ItemIndicator>
                    <Check aria-hidden />
                  </Select.ItemIndicator>
                  <Select.ItemText className={controls.itemText}>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
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
