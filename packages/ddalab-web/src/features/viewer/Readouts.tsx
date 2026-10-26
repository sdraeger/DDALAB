// The printed scale in a band under the traces: a 10 mm amplitude bar and a time bar drawn at their physical
// size, the sensitivity, the timebase and the view interval. Updated from the frame loop, outside React.
import { type ReactNode, type Ref, useImperativeHandle, useRef } from "react";
import { CSS_PX_PER_MM, timebaseOf, type View, voltage } from "../../store/store";
import styles from "./Viewer.module.css";

export interface ReadoutsHandle {
  update(view: View, plotCssWidth: number): void;
}

/** Durations the time bar may show, in seconds. */
const TIME_BARS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 300, 600, 1800, 3600];
const AMPLITUDE_MM = 10;
const SENSITIVITY_UNITS = ["µV/mm", "mV/mm"];

const trim = (value: number) => Number(value.toPrecision(3)).toString();

export function Readouts({ ref }: { ref: Ref<ReadoutsHandle> }) {
  const amplitudeBar = useRef<HTMLSpanElement>(null);
  const amplitude = useRef<HTMLSpanElement>(null);
  const timeBar = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const sensitivity = useRef<HTMLSpanElement>(null);
  const sensitivityUnit = useRef<HTMLSpanElement>(null);
  const timebase = useRef<HTMLElement>(null);
  const interval = useRef<HTMLElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      update(view, plotCssWidth) {
        const pxPerMm = CSS_PX_PER_MM / view.mmPerCssMm;
        const mmPerS = timebaseOf(view, plotCssWidth);
        // One second when it prints between 8 and 40 mm long, else the shortest bar of at least 8 mm.
        const seconds = mmPerS >= 8 && mmPerS <= 40 ? 1 : (TIME_BARS.find((s) => s * mmPerS >= 8) ?? 3600);
        const [amplitudeValue, amplitudeUnit] = voltage(AMPLITUDE_MM * view.sensitivityUvPerMm);
        const [sensitivityValue, unit] = voltage(view.sensitivityUvPerMm);
        set(amplitudeBar, (e) => (e.style.height = `${AMPLITUDE_MM * pxPerMm}px`));
        set(amplitude, (e) => (e.textContent = `${trim(amplitudeValue)} ${amplitudeUnit}`));
        set(timeBar, (e) => (e.style.width = `${seconds * mmPerS * pxPerMm}px`));
        set(time, (e) => (e.textContent = `${trim(seconds)} s`));
        set(sensitivity, (e) => (e.textContent = String(sensitivityValue)));
        set(sensitivityUnit, (e) => (e.textContent = `${unit}/mm`));
        set(timebase, (e) => (e.textContent = `${Number.isFinite(mmPerS) ? trim(mmPerS) : "0"} mm/s`));
        set(interval, (e) => (e.textContent = `${view.t0.toFixed(2)} to ${view.t1.toFixed(2)} s`));
      },
    }),
    [],
  );

  return (
    <div className={styles.readouts}>
      <span className={styles.amplitude} aria-hidden>
        <span ref={amplitudeBar} className={styles.amplitudeBar} />
        <span ref={amplitude} />
      </span>
      <span className={styles.time} aria-hidden>
        <span ref={timeBar} className={styles.timeBar} />
        <span ref={time} />
      </span>
      <dl className={styles.scale}>
        <div>
          <dt>Sensitivity</dt>
          <dd>
            <span ref={sensitivity} className={styles.digits} />{" "}
            <Units ref={sensitivityUnit} units={SENSITIVITY_UNITS} />
          </dd>
        </div>
        <div>
          <dt>Timebase</dt>
          <dd ref={timebase} />
        </div>
        <div>
          <dt>View</dt>
          <dd ref={interval} />
        </div>
      </dl>
    </div>
  );
}

/**
 * `children`, one of `units`, in a box as wide as the widest of them (hidden copies set its width): a unit that changes
 * moves nothing beside it.
 */
export function Units(props: { units: string[]; children?: ReactNode; ref?: Ref<HTMLSpanElement> }) {
  return (
    <span className={styles.units}>
      <span ref={props.ref}>{props.children}</span>
      {props.units.map((unit) => (
        <span key={unit} aria-hidden>
          {unit}
        </span>
      ))}
    </span>
  );
}

function set<T extends HTMLElement>(ref: { current: T | null }, apply: (element: T) => void) {
  if (ref.current) apply(ref.current);
}
