// The viewer of the active recording: the paging and scale controls of the command bar, the overview and the
// waveform. Loaded lazily (viewerChunk.ts): the start screen shows none of it.
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronFirst from "lucide-react/dist/esm/icons/chevron-first.mjs";
import ChevronLast from "lucide-react/dist/esm/icons/chevron-last.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import { type ReactNode, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AnnotateButton } from "../features/annotations/Annotate";
import { Overview } from "../features/viewer/Overview";
import { Units } from "../features/viewer/Readouts";
import { WaveformCanvas } from "../features/viewer/WaveformCanvas";
import {
  activeRecording,
  EPOCHS,
  type Epoch,
  MIN_SPAN_SAMPLES,
  pageBy,
  pageOf,
  pageToEnd,
  pageToStart,
  SENSITIVITIES,
  setEpoch,
  setTimebase,
  setView,
  timebaseOf,
  useStore,
  voltage,
} from "../store/store";
import controls from "../styles/controls.module.css";
import { IconButton } from "./Shell";
import styles from "./Shell.module.css";

/** The overview and the waveform of recording `id`. */
export function Plots({ id }: { id: string }) {
  return (
    <>
      <Overview key={`overview-${id}`} recordingId={id} />
      <WaveformCanvas key={id} recordingId={id} />
    </>
  );
}

const TIMEBASES = [10, 15, 20, 30, 60, 120];
/** The name of the button and the popover that hold the scale settings where the bar is short. */
const SCALES = "Epoch, sensitivity and timebase";

/** A timebase at three significant digits, as the bar shows it. */
const print = (mmPerS: number) => Number(mmPerS.toPrecision(3));

/**
 * The characters of the longest timebase from `lo` to `hi` mm/s prints in: below 1 its smallest decade (0.00123), from
 * 1 to 100 four (12.3), past that `hi` itself (12300).
 */
const timebaseChars = (lo: number, hi: number) =>
  Math.max(4, String(print(hi)).length, lo > 0 && lo < 1 ? 4 - Math.floor(Math.log10(lo)) : 0);

/** Paging and the physical scale of the plot. */
export function ViewControls() {
  const duration = useStore((s) => activeRecording(s)?.info.duration_s ?? 0);
  const rate = useStore((s) => activeRecording(s)?.info.sample_rate_hz ?? 1);
  const epochS = useStore((s) => s.view.epochS);
  // Whole pages only: they change on paging and hold over the frames of a pan.
  const [page, pages] = useStore(useShallow((s) => pageOf(s.view, duration)));
  const sensitivity = useStore((s) => s.view.sensitivityUvPerMm);
  // Three significant digits: it changes on zoom and holds over the frames of a pan.
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
      <ScaleChoices>
        <Choice
          label="Epoch"
          value={epochS}
          values={EPOCHS}
          unit="s"
          onChange={(e) => setEpoch(e as Epoch)}
        />
        <Choice
          label="Sensitivity"
          value={sensitivity}
          values={SENSITIVITIES}
          unit={(s) => {
            const [value, unit] = voltage(s);
            return [value, `${unit}/mm`];
          }}
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
      </ScaleChoices>
      <span className={controls.rule} />
      <AnnotateButton />
    </div>
  );
}

/**
 * The scale settings: in the bar while it has room for them, else behind one button (the widths are in
 * Shell.module.css). The popover mounts its copy only while open, when the bar's own is hidden.
 */
function ScaleChoices({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // A resize across a width of Shell.module.css moves the settings back into the bar: the popover closes.
  useEffect(() => {
    const queries = ["(width < 1440px)", "(width < 1600px)"].map((query) => matchMedia(query));
    const close = () => setOpen(false);
    for (const query of queries) query.addEventListener("change", close);
    return () => {
      for (const query of queries) query.removeEventListener("change", close);
    };
  }, []);
  return (
    <>
      <div className={styles.scales}>{children}</div>
      <span className={styles.scaleMenu}>
        <Popover.Root open={open} onOpenChange={setOpen}>
          <IconButton label={SCALES} render={<Popover.Trigger />}>
            <SlidersHorizontal aria-hidden />
          </IconButton>
          <Popover.Portal>
            <Popover.Positioner sideOffset={6}>
              <Popover.Popup className={`${controls.panel} ${styles.scaleList}`} aria-label={SCALES}>
                {children}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </span>
    </>
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
 * A labeled select of numbers in `unit`, or in the unit it gives each value. The value may lie between the items (the
 * timebase); its number keeps the width of the longest it can show, `chars` or else the longest item, and its unit
 * the width of the widest.
 */
function Choice(props: {
  label: string;
  value: number;
  values: number[];
  unit: string | ((value: number) => [number, string]);
  chars?: number;
  onChange(value: number): void;
}) {
  const { values, unit } = props;
  const show = (value: number) => (typeof unit === "string" ? ([value, unit] as const) : unit(value));
  const chars = Math.max(props.chars ?? 0, ...values.map((v) => String(show(v)[0]).length));
  const units = [...new Set(values.map((v) => show(v)[1]))];
  return (
    <Select.Root
      value={props.value}
      items={values.map((value) => ({ value, label: show(value).join(" ") }))}
      onValueChange={(value) => value !== null && props.onChange(value as number)}
    >
      <div className={controls.field}>
        <Select.Label className={controls.label}>{props.label}</Select.Label>
        <Select.Trigger className={controls.trigger}>
          <Select.Value>
            {(value: number) => (
              <>
                <Digits value={show(value)[0]} chars={chars} />{" "}
                {units.length > 1 ? <Units units={units}>{show(value)[1]}</Units> : show(value)[1]}
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
                  <Select.ItemText className={controls.itemText}>{show(value).join(" ")}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
