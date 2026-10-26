// What the pointer is over in the heatmap: the row, the center of the window and its value. Updated from the frame
// loop, outside React.
import { type Ref, useImperativeHandle, useRef } from "react";
import styles from "./Results.module.css";

export interface HoverFields {
  row: string;
  /** The window's center, in seconds from the recording start. */
  center: number;
  /** As stored (float32); `undefined` while it is read. */
  value: number | undefined;
  /** The array's name: Q or Fit error. */
  name: string;
}

export interface HoverReadoutHandle {
  /** At `x`, `y` (CSS pixels in a plot `width` by `height`): beside the pointer, inside the plot. */
  show(x: number, y: number, width: number, height: number, fields: HoverFields): void;
  hide(): void;
}

const GAP = 12;

export function HoverReadout({ ref }: { ref: Ref<HoverReadoutHandle> }) {
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLElement>(null);
  const center = useRef<HTMLSpanElement>(null);
  const value = useRef<HTMLSpanElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      show(x, y, width, height, fields) {
        const [el, rowEl, centerEl, valueEl] = [box.current, row.current, center.current, value.current];
        if (!el || !rowEl || !centerEl || !valueEl) return;
        rowEl.textContent = fields.row;
        centerEl.textContent = `${fields.center.toFixed(3)} s`;
        valueEl.textContent =
          fields.value === undefined ? fields.name : `${fields.name} ${fields.value.toPrecision(4)}`;
        el.hidden = false;
        const w = el.offsetWidth;
        const left = x + GAP + w > width ? Math.max(0, x - GAP - w) : x + GAP;
        const top = Math.max(0, Math.min(y + GAP, height - el.offsetHeight));
        el.style.transform = `translate(${left}px, ${top}px)`;
      },
      hide() {
        if (box.current) box.current.hidden = true;
      },
    }),
    [],
  );

  return (
    <div ref={box} role="tooltip" className={styles.readout} hidden>
      <b ref={row} />
      <span ref={center} />
      <span ref={value} />
    </div>
  );
}
