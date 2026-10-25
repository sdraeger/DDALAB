// OpenNeuro in the library rail: search public datasets, walk a snapshot's folders, stream a recording in place.
// It also opens the recording a deep link names (see deepLink.ts). The rail loads it lazily.
import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { openInput } from "../../app/recordings";
import rail from "../library/LibraryRail.module.css";
import {
  type DatasetHit,
  listFiles,
  type RemoteFile,
  recordingFiles,
  recordingInput,
  SEARCH_LIMIT,
  searchDatasets,
} from "./api";
import { DEMO, type DeepLink, linkedInput, parseDeepLink } from "./deepLink";
import styles from "./OpenNeuroPanel.module.css";

type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; text: string };
const IDLE: Status = { kind: "idle" };
const failed = (error: unknown): Status => ({
  kind: "error",
  text: error instanceof Error ? error.message : String(error),
});

const link = parseDeepLink(location.search);
/**
 * The recording the page's link names, opened once when the panel first loads. It settles with the failure, if any:
 * a rejection could come before the panel mounts to handle it.
 */
const linked = link
  ? linkedInput(link)
      .then(openInput)
      .then(
        () => undefined,
        (error: unknown) => failed(error),
      )
  : undefined;
const opening = (target: DeepLink) => `Opening ${target.path.split("/").at(-1)}`;

/** The formats the panel offers to open; the BIDS text files beside them are sidecars. */
const RECORDING = /\.(vhdr|edf|bdf)$/i;
const megabytes = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "megabyte",
  maximumSignificantDigits: 3,
});

interface Results {
  query: string;
  hits: DatasetHit[];
}

/** A folder of a snapshot: its dataset, the folders walked from the top (each with its tree), its listing. */
interface Place {
  dataset: DatasetHit;
  trail: { name: string; tree: string }[];
  files: RemoteFile[];
}

export function OpenNeuroPanel() {
  const [status, setStatus] = useState<Status>(link ? { kind: "busy", text: opening(link) } : IDLE);
  const [results, setResults] = useState<Results | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const searching = useRef<AbortController | null>(null);
  // The number of the latest operation: only it shows its status and result, and a late answer is dropped.
  const latest = useRef(0);

  useEffect(() => {
    if (!linked) return;
    const mine = ++latest.current;
    linked.then((failure) => {
      if (mine === latest.current) setStatus(failure ?? IDLE);
    });
  }, []);

  /** Runs `task` as the latest operation; `show` takes its result unless a newer operation started meanwhile. */
  async function run<T>(text: string, task: () => Promise<T>, show?: (result: T) => void) {
    const mine = ++latest.current;
    setStatus({ kind: "busy", text });
    try {
      const result = await task();
      if (mine !== latest.current) return;
      show?.(result);
      setStatus(IDLE);
    } catch (error) {
      if (mine === latest.current) setStatus(failed(error));
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query")).trim();
    if (!query) return;
    searching.current?.abort();
    const controller = new AbortController();
    searching.current = controller;
    void run(
      "Searching",
      () => searchDatasets(query, controller.signal),
      (hits) => {
        setResults({ query, hits });
        setPlace(null);
      },
    );
  }

  const browse = (dataset: DatasetHit, trail: Place["trail"]) =>
    run(
      `Listing ${trail.at(-1)?.name ?? dataset.id}`,
      () => listFiles(dataset.id, dataset.tag, trail.at(-1)?.tree),
      (files) => setPlace({ dataset, trail, files }),
    );

  function showResults() {
    latest.current++; // a listing still on its way stays out
    setPlace(null);
    setStatus(IDLE);
  }

  function openDemo(event: MouseEvent) {
    // A plain click opens in place and keeps what is open; the link stays to copy, share or open in a new tab.
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const demo = parseDeepLink(DEMO) as DeepLink;
    void run(opening(demo), async () => openInput(await linkedInput(demo)));
  }

  return (
    <section className={rail.section} aria-labelledby="openneuro-heading">
      <h2 id="openneuro-heading" className={rail.heading}>
        OpenNeuro
      </h2>
      <search className={styles.search}>
        <form onSubmit={search}>
          <input
            type="search"
            name="query"
            className={styles.field}
            aria-label="Search OpenNeuro"
            placeholder="Search public datasets"
          />
        </form>
        <StatusLine status={status} />
      </search>
      {place ? (
        <FolderView
          place={place}
          onResults={showResults}
          onBrowse={(trail) => browse(place.dataset, trail)}
          onOpen={(name) => run(`Opening ${name}`, () => openInput(recordingInput(place.files, name)))}
        />
      ) : results ? (
        <ResultList results={results} onBrowse={(dataset) => browse(dataset, [])} />
      ) : (
        <p className={rail.hint}>
          Recordings stream in place from OpenNeuro, a range at a time. Try the{" "}
          <a href={DEMO} onClick={openDemo}>
            ds003029 seizure recording
          </a>
          .
        </p>
      )}
    </section>
  );
}

/** The panel's live region stays mounted for screen readers to follow its changes; an error is an alert below it. */
function StatusLine({ status }: { status: Status }) {
  return (
    <>
      <p className={`${rail.hint} ${styles.status}`} aria-live="polite">
        {status.kind === "busy" ? status.text : ""}
      </p>
      {status.kind === "error" && (
        <p role="alert" className={`${rail.error} ${styles.status}`}>
          {status.text}
        </p>
      )}
    </>
  );
}

function ResultList(props: { results: Results; onBrowse(dataset: DatasetHit): void }) {
  const { query, hits } = props.results;
  if (hits.length === 0) return <p className={rail.hint}>No public dataset matches “{query}”.</p>;
  return (
    <>
      <ul className={rail.entries} aria-label="Datasets">
        {hits.map((hit) => (
          <li key={hit.id}>
            <button type="button" className={rail.entry} title={hit.name} onClick={() => props.onBrowse(hit)}>
              <span className={rail.entryName}>{hit.name}</span>
              <span className={`${rail.entryMeta} ${styles.wrap}`}>
                {hit.id}
                {hit.modalities.length > 0 && (
                  <>
                    <span className={rail.thin} aria-hidden />
                    {hit.modalities.join(" ")}
                  </>
                )}
                {hit.subjects > 0 && (
                  <>
                    <span className={rail.thin} aria-hidden />
                    {hit.subjects} {hit.subjects === 1 ? "subject" : "subjects"}
                  </>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hits.length === SEARCH_LIMIT && (
        <p className={rail.hint}>First {SEARCH_LIMIT} matches. Add words to narrow the search.</p>
      )}
    </>
  );
}

function FolderView(props: {
  place: Place;
  onResults(): void;
  onBrowse(trail: Place["trail"]): void;
  onOpen(name: string): void;
}) {
  const { dataset, trail, files } = props.place;
  const folders = files.filter((file) => file.directory);
  const recordings = files.filter((file) => !file.directory && RECORDING.test(file.filename));
  const others = files.length - folders.length - recordings.length;
  const here = trail.at(-1)?.name ?? dataset.id;
  return (
    <>
      <nav aria-label="Folder" className={styles.trail}>
        <button type="button" className={styles.step} onClick={props.onResults}>
          Results
        </button>
        {[{ name: dataset.id, tree: "top" }, ...trail].map(({ name, tree }, i) => (
          <span key={tree} className={styles.trailItem}>
            <span aria-hidden className={styles.slash}>
              /
            </span>
            {i === trail.length ? (
              <span aria-current="location">{name}</span>
            ) : (
              <button type="button" className={styles.step} onClick={() => props.onBrowse(trail.slice(0, i))}>
                {name}
              </button>
            )}
          </span>
        ))}
      </nav>
      <p className={rail.hint}>
        {dataset.name}, version {dataset.tag}
      </p>
      <ul className={rail.entries} aria-label={`Files in ${here}`}>
        {folders.map((folder) => (
          <li key={folder.id}>
            <button
              type="button"
              className={rail.entry}
              onClick={() => props.onBrowse([...trail, { name: folder.filename, tree: folder.id }])}
            >
              <span className={styles.folder}>
                <Folder aria-hidden />
                <span className={styles.name}>{folder.filename}</span>
              </span>
            </button>
          </li>
        ))}
        {recordings.map((file) => (
          <li key={file.id}>
            <button type="button" className={rail.entry} onClick={() => props.onOpen(file.filename)}>
              <span className={styles.name}>{file.filename}</span>
              <span className={rail.entryMeta}>
                {megabytes.format(
                  recordingFiles(files, file.filename).reduce((sum, f) => sum + f.size, 0) / 1e6,
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {others > 0 && (
        <p className={rail.hint}>
          {others} other {others === 1 ? "file" : "files"}
        </p>
      )}
    </>
  );
}
