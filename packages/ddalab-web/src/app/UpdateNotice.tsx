// The notice at the foot of the window when a new version of the app is ready: Reload switches to it. While a DDA run is
// in progress the notice says so, and Reload reloads when the run has ended. The live region is always in the page:
// a screen reader hears the text that comes into it.
import { useEffect, useState } from "react";
import { useStore } from "../store/store";
import controls from "../styles/controls.module.css";
import styles from "./UpdateNotice.module.css";
import { applyUpdate } from "./update";

export function UpdateNotice() {
  const ready = useStore((s) => s.updateReady);
  const running = useStore((s) => s.run?.status === "running");
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    if (ready && queued && !running) applyUpdate();
  }, [ready, queued, running]);
  const waiting = queued && running;
  return (
    <div role="status" className={styles.notice}>
      {ready && (
        <div className={styles.message} data-appear>
          <p>
            {waiting
              ? "DDALAB reloads when the run ends."
              : running
                ? "A new version of DDALAB will be ready after the run."
                : "A new version of DDALAB is ready."}
          </p>
          {/* The button stays while the reload waits, and stays focusable: pressing it must not drop the focus. */}
          <button
            type="button"
            className={controls.quiet}
            aria-disabled={waiting}
            onClick={() => {
              if (waiting) return;
              if (running) setQueued(true);
              else applyUpdate();
            }}
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
