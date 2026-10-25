// The history in the library rail: the results of this browser, newest first, and how each run ended. A row opens
// its result with its provenance, where it is exported or deleted. Results the CLI wrote come in through the import
// below the list.
import { lazy, Suspense, useMemo, useState, useTransition } from "react";
import { type AnalysisRecord, resultName } from "../../core/history";
import { openResult, useStore } from "../../store/store";
import rail from "../library/LibraryRail.module.css";
import styles from "./History.module.css";

const ImportDrop = lazy(() => import("./ImportDrop"));

const STATUS: Record<AnalysisRecord["status"], string> = {
  running: "Running",
  complete: "Complete",
  interrupted: "Interrupted",
  failed: "Failed",
};

/** From this many results on the history offers a search. */
const SEARCH_FROM = 6;

/** The time of day for a result of today, else the date. */
function when(time: number) {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export default function HistoryRail() {
  const analyses = useStore((s) => s.analyses);
  const active = useStore((s) => s.activeResultId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [filtering, startTransition] = useTransition();
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? analyses.filter((a) => resultName(a).toLowerCase().includes(needle)) : analyses;
  }, [analyses, filter]);
  return (
    <section className={rail.section} aria-label="History">
      <h2 className={rail.heading}>
        History <span className={rail.count}>{analyses.length}</span>
      </h2>
      {analyses.length >= SEARCH_FROM && (
        <input
          type="search"
          className={styles.search}
          aria-label="Search the history"
          placeholder="Variant or file name"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            startTransition(() => setFilter(event.target.value));
          }}
        />
      )}
      {analyses.length === 0 ? (
        <p className={rail.hint}>The results you run or import are kept here.</p>
      ) : (
        <ul className={`${rail.entries} ${styles.results}`} data-stale={filtering || undefined}>
          {shown.map((analysis) => (
            <li key={analysis.id}>
              <button
                type="button"
                className={rail.entry}
                aria-current={analysis.id === active ? "true" : undefined}
                onClick={() => openResult(analysis.id)}
              >
                <span className={rail.entryName}>{resultName(analysis)}</span>
                <span className={rail.entryMeta}>
                  <span className={analysis.status === "failed" ? styles.failed : undefined}>
                    {STATUS[analysis.status]}
                  </span>
                  <span className={rail.thin} aria-hidden />
                  <time dateTime={new Date(analysis.createdAt).toISOString()}>
                    {when(analysis.createdAt)}
                  </time>
                  <span className={rail.thin} aria-hidden />
                  {analysis.request.channels?.length ?? 0} channels
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Suspense fallback={null}>
        <ImportDrop />
      </Suspense>
    </section>
  );
}
