// The display filter in the scale band: its settings under the traces, and a popover that sets them (core/filter.ts).
import { Popover } from "@base-ui/react/popover";
import { SelectField } from "../../app/SelectField";
import { type Filter, filterLabel, MAX_FRACTION, NO_FILTER } from "../../core/filter";
import { activeRecording, setFilter, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Viewer.module.css";

const HIGHPASS = [0.1, 0.3, 0.5, 1, 4, 8, 13, 30];
const LOWPASS = [4, 8, 13, 30, 40, 70, 100];
const BANDS = [
  ["Delta", 0.5, 4],
  ["Theta", 4, 8],
  ["Alpha", 8, 13],
  ["Beta", 13, 30],
  ["Gamma", 30, 100],
] as const;

export function Filters() {
  const filter = useStore((s) => s.filter);
  const rate = useStore((s) => activeRecording(s)?.info.sample_rate_hz ?? Infinity);
  const { highpassHz: hp, lowpassHz: lp } = filter;
  const usable = (hz: number) => hz < MAX_FRACTION * rate;
  return (
    <div className={styles.filterReadout}>
      <dt>Filter</dt>
      <dd>
        <Popover.Root>
          <Popover.Trigger
            className={styles.filterButton}
            data-on={filterLabel(filter) !== "Off"}
            aria-label={`Display filter: ${filterLabel(filter)}`}
          >
            {filterLabel(filter)}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="top" sideOffset={8}>
              <Popover.Popup
                className={`${controls.panel} ${styles.filterPanel}`}
                aria-label="Display filter"
              >
                <Hz
                  label="High-pass"
                  value={hp}
                  values={HIGHPASS}
                  usable={(hz) => usable(hz) && (lp === null || hz < lp)}
                  onChange={(highpassHz) => setFilter({ highpassHz })}
                />
                <Hz
                  label="Low-pass"
                  value={lp}
                  values={LOWPASS}
                  usable={(hz) => usable(hz) && (hp === null || hz > hp)}
                  onChange={(lowpassHz) => setFilter({ lowpassHz })}
                />
                <Hz
                  label="Line noise"
                  value={filter.notchHz}
                  values={[50, 60]}
                  usable={usable}
                  onChange={(notchHz) => setFilter({ notchHz: notchHz as Filter["notchHz"] })}
                />
                <fieldset className={styles.bands}>
                  <legend className={controls.label}>Bands</legend>
                  {BANDS.map(([name, lo, hi]) => (
                    <button
                      key={name}
                      type="button"
                      className={controls.button}
                      aria-pressed={hp === lo && lp === hi}
                      disabled={!usable(hi)}
                      title={`${lo}–${hi} Hz`}
                      onClick={() => setFilter({ highpassHz: lo, lowpassHz: hi })}
                    >
                      {name}
                    </button>
                  ))}
                </fieldset>
                <p className={styles.filterNote}>
                  Changes only what the viewer draws; DDA reads the recording unfiltered. Zoomed out past 64
                  samples per pixel, the traces show the unfiltered extremes.
                </p>
                <button type="button" className={controls.quiet} onClick={() => setFilter(NO_FILTER)}>
                  Turn off
                </button>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </dd>
    </div>
  );
}

/** A labeled select of frequencies in Hz, with Off; a frequency `usable` refuses shows but cannot be picked. */
function Hz(props: {
  label: string;
  value: number | null;
  values: number[];
  usable(hz: number): boolean;
  onChange(hz: number | null): void;
}) {
  const label = (hz: number) => (hz ? `${hz} Hz` : "Off");
  return (
    <SelectField
      label={props.label}
      value={props.value ?? 0}
      items={[0, ...props.values].map((value) => ({
        value,
        label: label(value),
        disabled: value !== 0 && !props.usable(value),
      }))}
      onChange={(value) => props.onChange(value || null)}
    />
  );
}
