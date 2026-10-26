// The command bar's note that data stays on this device: recordings are read and analyzed in the browser, and what
// this device brings to an analysis bounds how much it can take. Its Storage section says what the site keeps in the
// browser and clears the cached tiles and the copy of the last export made for the downloads.
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive.mjs";
import { useEffect, useId, useState } from "react";
import { clearSpool, spoolBytes } from "../../app/download";
import { ddaWorkers } from "../../core/engine";
import { evictTiles } from "../../core/opfs";
import controls from "../../styles/controls.module.css";
import styles from "./LocalData.module.css";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const size = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toLocaleString("en", { maximumFractionDigits: 1 })} GB`
    : bytes >= 1e6
      ? `${Math.round(bytes / 1e6).toLocaleString("en")} MB`
      : `${Math.ceil(bytes / 1e3).toLocaleString("en")} kB`;

type Usage = { used: number; quota: number; tiles: number; spool: number };

/** What the browser holds for this site, and how much of it is cached tiles (an eviction with no limit deletes none). */
async function measure(): Promise<Usage> {
  const [estimate, tiles, spool] = await Promise.all([
    navigator.storage.estimate(),
    evictTiles(Number.POSITIVE_INFINITY),
    spoolBytes(),
  ]);
  return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0, tiles, spool };
}

/**
 * The site's storage, with "Clear cached tiles": results, the history and the tiles of open recordings stay; the copy of
 * the last export goes too.
 */
function Storage() {
  const heading = useId();
  const [usage, setUsage] = useState<Usage | "none" | null>(null);
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    let live = true;
    measure().then(
      (found) => live && setUsage(found),
      () => live && setUsage("none"),
    );
    return () => {
      live = false;
    };
  }, []);
  const clear = async () => {
    setUsage(null);
    await Promise.all([evictTiles(0).catch(() => {}), clearSpool()]);
    setCleared(true);
    setUsage(await measure().catch(() => "none" as const));
  };
  return (
    <section className={styles.storage} aria-labelledby={heading}>
      <h3 id={heading} className={styles.heading}>
        Storage
      </h3>
      <p className={styles.text}>
        {usage === null
          ? "Measuring…"
          : usage === "none"
            ? "Browser storage is not available in this window."
            : `This site uses ${size(usage.used)} of the ${size(usage.quota)} the browser allows it. Cached tiles take ${size(usage.tiles)}.${usage.spool > 0 ? ` The copy of the last export takes ${size(usage.spool)}.` : ""}`}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={controls.button}
          disabled={usage === null || usage === "none" || usage.tiles + usage.spool === 0}
          onClick={() => void clear()}
        >
          Clear cached tiles
        </button>
        <span className={styles.text} aria-live="polite">
          {cleared && "Results stay, and so do the tiles of open recordings."}
        </span>
      </div>
    </section>
  );
}

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
            <Storage />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
