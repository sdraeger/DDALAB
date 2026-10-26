// The notice at the foot of the window when a new version of the app is installed and waits: Reload switches to it.
// While a DDA run is in progress the notice says so, and Reload waits for the run to end.
import { useEffect, useState } from "react";
import { useStore } from "../store/store";
import controls from "../styles/controls.module.css";
import styles from "./UpdateNotice.module.css";
import { applyUpdate, useUpdateWaiting } from "./update";

export function UpdateNotice() {
  const ready = useUpdateWaiting();
  const running = useStore((s) => s.run?.status === "running");
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    if (ready && queued && !running) applyUpdate();
  }, [ready, queued, running]);
  if (!ready) return null;
  return (
    <div role="status" className={styles.notice}>
      {queued && running ? (
        <p>DDALAB reloads when the run ends.</p>
      ) : (
        <>
          <p>
            {running
              ? "A new version of DDALAB will be ready after the run."
              : "A new version of DDALAB is ready."}
          </p>
          <button
            type="button"
            className={controls.quiet}
            onClick={() => (running ? setQueued(true) : applyUpdate())}
          >
            Reload
          </button>
        </>
      )}
    </div>
  );
}
