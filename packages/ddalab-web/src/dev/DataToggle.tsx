// Dev-only: a switch at the bottom of the window between demo and worst-case data, shown when the URL has `?data=`
// (http://localhost:5173/?data=worst). The choice lives there, so a reload keeps it; opening a data set closes every
// tab first. Mounted by main.tsx in dev builds only.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { openInput } from "../app/recordings";
import { closeAll } from "../app/tabs";
import styles from "./DataToggle.module.css";
import { type DataSet, inputsOf } from "./worstCase";

const SETS: [DataSet, string][] = [
  ["demo", "Demo"],
  ["worst", "Worst case"],
  ["empty", "Empty"],
  ["one", "One"],
  ["huge", "Huge"],
];

const current = () => new URLSearchParams(location.search).get("data") as DataSet | null;

async function load(set: DataSet) {
  closeAll();
  for (const input of inputsOf(set)) await openInput(input);
}

function DataToggle() {
  const [set, setSet] = useState(current);
  const choose = (next: DataSet) => {
    const url = new URL(location.href);
    url.searchParams.set("data", next);
    history.replaceState(null, "", url);
    setSet(next);
    void load(next).catch((e) => console.error("data toggle:", e));
  };
  return (
    <fieldset className={styles.toggle} aria-label="Dev data">
      {SETS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={set === value}
          className={styles.segment}
          onClick={() => choose(value)}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * With `?data=` in the URL (only then: the e2e tests run on the dev server and check every landmark), mounts the toggle
 * and, once the stored tabs are back (`restored`), opens that data set.
 */
export function mount(restored: Promise<unknown>) {
  const set = current();
  if (!set) return;
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(<DataToggle />);
  void restored.then(() => load(set)).catch((e) => console.error("data toggle:", e));
}
