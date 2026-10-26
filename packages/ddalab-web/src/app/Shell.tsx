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
import { ResultBoundary } from "../features/history/ResultBoundary";
import { Inspector } from "../features/inspector/Inspector";
import { LibraryRail } from "../features/library/LibraryRail";
import { LocalData } from "../features/settings/LocalData";
import { Overview } from "../features/viewer/Overview";
import { useViewerKeys } from "../features/viewer/useViewerKeys";
import { WaveformCanvas } from "../features/viewer/WaveformCanvas";
import {
  activeRecording,
  EPOCHS,
  type Epoch,
  MIN_SPAN_SAMPLES,
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
import { Logo } from "./Logo";
import styles from "./Shell.module.css";

const Calibration = lazy(() => import("../features/settings/Calibration"));
const ResultPanel = lazy(() => import("../features/results/ResultPanel"));

const TIMEBASES = [10, 15, 20, 30, 60, 120];

/** A timebase at three significant digits, as the bar shows it. */
const print = (mmPerS: number) => Number(mmPerS.toPrecision(3));

/**
 * The characters of the longest timebase from `lo` to `hi` mm/s prints in: below 1 its smallest decade (0.00123), from
 * 1 to 100 four (12.3), past that `hi` itself (12300).
 */
const timebaseChars = (lo: number, hi: number) =>
  Math.max(4, String(print(hi)).length, lo > 0 && lo < 1 ? 4 - Math.floor(Math.log10(lo)) : 0);

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
          <span className={styles.brand}>
            <Logo />
            <span className={styles.wordmark}>DDALAB</span>
          </span>
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
          <LocalData />
          <ThemeToggle />
        </header>
        <aside className={styles.library} aria-label="Library" data-appear>
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
            <p className={styles.empty} data-appear>
              Open a recording from the library, or drop its files or folder anywhere in this window.
            </p>
          )}
        </main>
        <aside className={styles.inspector} data-appear>
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
    <span className={styles.name} title={name} data-appear>
      {name}
    </span>
  ) : null;
}

/** Paging and the physical scale of the plot. */
function ViewControls() {
  const duration = useStore((s) => activeRecording(s)?.info.duration_s ?? 0);
  const rate = useStore((s) => activeRecording(s)?.info.sample_rate_hz ?? 1);
  const epochS = useStore((s) => s.view.epochS);
  // Whole pages only: they change on paging, not on every pan frame.
  const [page, pages] = useStore(useShallow((s) => pageOf(s.view, duration)));
  const sensitivity = useStore((s) => s.view.sensitivityUvPerMm);
  // Three significant digits: it changes on zoom, not on every pan frame.
  const timebase = useStore((s) => print(timebaseOf(s.view, s.plotCssWidth)));
  // Its width holds over every span the view can take, from the whole recording to the shortest.
  const timebaseWidth = useStore((s) => {
    const across = (span: number) => timebaseOf({ ...s.view, t0: 0, t1: span }, s.plotCssWidth);
    return timebaseChars(across(duration), across(MIN_SPAN_SAMPLES / rate));
  });
  return (
    <div className={styles.view} data-appear>
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
          Page <Digits value={page} chars={String(pages).length} /> of {pages}
        </span>
      </div>
      <span className={controls.rule} />
      <Choice label="Epoch" value={epochS} values={EPOCHS} unit="s" onChange={(e) => setEpoch(e as Epoch)} />
      <Choice
        label="Sensitivity"
        value={sensitivity}
        values={SENSITIVITIES}
        unit="µV/mm"
        onChange={(s) => setView({ sensitivityUvPerMm: s })}
      />
      <Choice
        label="Timebase"
        value={timebase}
        values={TIMEBASES}
        unit="mm/s"
        chars={timebaseWidth}
        onChange={setTimebase}
      />
    </div>
  );
}

/** A number in a box `chars` digits wide, aligned to its end: a value that changes moves nothing beside it. */
function Digits({ value, chars }: { value: number; chars: number }) {
  return (
    <span className={styles.digits} style={{ inlineSize: `${chars}ch` }}>
      {value}
    </span>
  );
}

/**
 * A labeled select of numbers in `unit`. The value may lie between the items (the timebase); its number keeps the
 * width of the longest it can show, `chars` or else the longest item.
 */
function Choice(props: {
  label: string;
  value: number;
  values: number[];
  unit: string;
  chars?: number;
  onChange(value: number): void;
}) {
  const { values, unit } = props;
  const chars = Math.max(props.chars ?? 0, ...values.map((v) => String(v).length));
  return (
    <Select.Root
      value={props.value}
      items={values.map((value) => ({ value, label: `${value} ${unit}` }))}
      onValueChange={(value) => value !== null && props.onChange(value as number)}
    >
      <div className={controls.field}>
        <Select.Label className={controls.label}>{props.label}</Select.Label>
        <Select.Trigger className={controls.trigger}>
          <Select.Value>
            {(value: number) => (
              <>
                <Digits value={value} chars={chars} /> {unit}
              </>
            )}
          </Select.Value>
          <Select.Icon>
            <ChevronDown aria-hidden />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className={controls.popup}>
            <Select.List className={controls.list}>
              {values.map((value) => (
                <Select.Item key={value} value={value} className={controls.item}>
                  <Select.ItemIndicator>
                    <Check aria-hidden />
                  </Select.ItemIndicator>
                  <Select.ItemText className={controls.itemText}>{`${value} ${unit}`}</Select.ItemText>
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

/**
 * Follows the system until pressed; the pick is remembered (theme.ts). The page crossfades to the new theme where the
 * browser has view transitions (base.css times it); elsewhere it switches at once.
 */
function ThemeToggle() {
  const picked = useStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeToScheme, () => darkQuery().matches);
  const dark = (picked ?? (systemDark ? "dark" : "light")) === "dark";
  const toggle = () => setTheme(dark ? "light" : "dark");
  return (
    <IconButton
      label="Dark theme"
      aria-pressed={dark}
      onClick={() => (document.startViewTransition ? document.startViewTransition(toggle) : toggle())}
    >
      <Moon aria-hidden />
    </IconButton>
  );
}
