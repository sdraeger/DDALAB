// The viewer of the active recording: the paging and scale controls of the command bar, the overview and the
// waveform. Loaded lazily (viewerChunk.ts): the start screen shows none of it.
import { Select } from "@base-ui/react/select";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronFirst from "lucide-react/dist/esm/icons/chevron-first.mjs";
import ChevronLast from "lucide-react/dist/esm/icons/chevron-last.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { useShallow } from "zustand/react/shallow";
import { Overview } from "../features/viewer/Overview";
import { WaveformCanvas } from "../features/viewer/WaveformCanvas";
import {
  activeRecording,
  EPOCHS,
  type Epoch,
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
} from "../store/store";
import controls from "../styles/controls.module.css";
import { IconButton } from "./Shell";
import styles from "./Shell.module.css";

const TIMEBASES = [10, 15, 20, 30, 60, 120];

/** The overview and the waveform of recording `id`. */
export function Plots({ id }: { id: string }) {
  return (
    <>
      <Overview key={`overview-${id}`} recordingId={id} />
      <WaveformCanvas key={id} recordingId={id} />
    </>
  );
}

/** Paging and the physical scale of the plot. */
export function ViewControls() {
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
