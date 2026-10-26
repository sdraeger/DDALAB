// The command bar's note that data stays on this device: recordings are read and analyzed in the browser, and what
// this device brings to an analysis bounds how much it can take.
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive.mjs";
import { ddaWorkers } from "../../core/engine";
import controls from "../../styles/controls.module.css";
import styles from "./LocalData.module.css";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Cores, the most DDA workers a run takes and, where the browser tells it (Chromium, as a rounded-down bound), memory. */
function device() {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  const parts = [
    count(navigator.hardwareConcurrency, "logical core"),
    `up to ${count(ddaWorkers(), "analysis worker")}`,
    memory && `at least ${memory} GB memory`,
  ];
  return `This device: ${parts.filter(Boolean).join(", ")}.`;
}

export function LocalData() {
  return (
    <Popover.Root>
      {/* The tooltip names the mark where the bar keeps it alone (below 1024 px, LocalData.module.css). */}
      <Tooltip.Root>
        <Tooltip.Trigger
          className={`${controls.quiet} ${styles.trigger}`}
          aria-label="Local: data stays on this device"
          render={<Popover.Trigger />}
        >
          <HardDrive aria-hidden />
          <span className={styles.label}>Local</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={6}>
            <Tooltip.Popup className={controls.tooltip}>Data stays on this device</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup className={`${controls.panel} ${styles.content}`}>
            <Popover.Title className={styles.title}>Everything stays on this device</Popover.Title>
            <p className={styles.text}>
              Recordings are read directly in your browser. Nothing is uploaded, and the site keeps no copy of
              your data or results.
            </p>
            <p className={styles.text}>
              Every analysis runs on this device. Its memory and processor set how large a recording and how
              long an analysis can be.
            </p>
            <p>{device()}</p>
            <p className={styles.text}>OpenNeuro recordings stream from OpenNeuro to this device.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
