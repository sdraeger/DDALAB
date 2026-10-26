// The command bar's note that data stays on this device: recordings are read and analyzed in the browser, and what
// this device brings to an analysis bounds how much it can take.
import { Popover } from "@base-ui/react/popover";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive.mjs";
import { ddaWorkers } from "../../core/engine";
import controls from "../../styles/controls.module.css";
import styles from "./LocalData.module.css";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Cores, DDA workers and, where the browser tells it (Chromium, as a rounded-down bound), memory. */
function device() {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  const parts = [
    count(navigator.hardwareConcurrency, "logical core"),
    count(ddaWorkers(), "analysis worker"),
    memory && `at least ${memory} GB memory`,
  ];
  return `This device: ${parts.filter(Boolean).join(", ")}.`;
}

export function LocalData() {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={`${controls.quiet} ${styles.trigger}`}
        aria-label="Data stays on this device"
      >
        <HardDrive aria-hidden />
        Local
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup className={`${controls.panel} ${styles.content}`}>
            <Popover.Title className={styles.title}>Everything stays on this device</Popover.Title>
            <p className={styles.text}>
              Recordings are read directly in your browser. Nothing is uploaded, and the site keeps no copy of
              your data or results.
            </p>
            <p className={styles.text}>
              Every analysis runs on this computer. How long a recording or an analysis can be depends on its
              memory and processor.
            </p>
            <p>{device()}</p>
            <p className={styles.text}>OpenNeuro recordings stream from OpenNeuro to this device.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
