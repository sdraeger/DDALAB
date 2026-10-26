// The history in the library rail: the results of this browser, newest first, and how each run ended. A row opens
// its result with its provenance, where it is exported or deleted. Results the CLI wrote come in through the import
// below the list.
import { useMemo, useState, useTransition } from "react";
import { inTransition } from "../../app/viewTransition";
import { type AnalysisRecord, resultName } from "../../core/history";
import { openResult, useStore } from "../../store/store";
import rail from "../library/LibraryRail.module.css";
import { prefetch } from "../results/loads";
import styles from "./History.module.css";
import ImportDrop from "./ImportDrop";
import { ResultBoundary } from "./ResultBoundary";

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
  return (
    <ResultBoundary what="The history">
      <Results />
    </ResultBoundary>
  );
}

function Results() {
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
    <section className={rail.section} aria-label="History" data-appear>
      <h2 id="history-heading" className={rail.heading} tabIndex={-1}>
        History <span className={rail.count}>{analyses.length}</span>
      </h2>
      {analyses.length >= SEARCH_FROM && (
        <input
          type="search"
          className={styles.search}
          data-appear
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
        <p className={rail.hint} data-appear>
          The results you run or import are kept here.
        </p>
      ) : (
        <ul className={`${rail.entries} ${styles.results}`} data-stale={filtering || undefined}>
          {shown.map((analysis) => (
            <li key={analysis.id} data-appear>
              <button
                type="button"
                className={rail.entry}
                data-result={analysis.id}
                aria-current={analysis.id === active ? "true" : undefined}
                // Pointing at a complete result, or tabbing to it, starts loading its manifest.
                onPointerEnter={analysis.status === "complete" ? () => prefetch(analysis.id) : undefined}
                onFocus={analysis.status === "complete" ? () => prefetch(analysis.id) : undefined}
                onClick={() => inTransition(() => openResult(analysis.id))}
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
      <ImportDrop />
    </section>
  );
}
