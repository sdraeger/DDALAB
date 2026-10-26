// OpenNeuro in the library rail: search public datasets by words, modality and order a page at a time, read a
// snapshot's description and pick another snapshot, walk its folders, stream a recording in place, and run a batch on
// the recordings of a folder and below. It also opens the recording a deep link names (see deepLink.ts). The rail
// loads it lazily.
import { Select } from "@base-ui/react/select";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { openInput } from "../../app/recordings";
import type { BatchRecord } from "../../core/batch";
import { useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import { BatchAction, BatchProgressView } from "../library/Batch";
import rail from "../library/LibraryRail.module.css";
import {
  citationOf,
  type DatasetHit,
  type DatasetInfo,
  datasetInfo,
  listFiles,
  RECORDING,
  type RemoteFile,
  type RemoteRecording,
  recordingFiles,
  recordingInput,
  type Search,
  type Sort,
  searchDatasets,
  sourceOf,
  walkRecordings,
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

const megabytes = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "megabyte",
  maximumSignificantDigits: 3,
});

/** The modalities a search may ask for: those DDALAB reads, by OpenNeuro's names. */
const MODALITIES = [
  { value: "", label: "Any" },
  { value: "eeg", label: "EEG" },
  { value: "ieeg", label: "iEEG" },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "name_asc", label: "Name" },
];

interface Results {
  search: Search;
  hits: DatasetHit[];
  count: number;
  next: string | null;
}

/**
 * A folder of a snapshot: its dataset (with the snapshot shown), the snapshot's description where it came, the folders
 * walked from the top (each with its tree), its listing.
 */
interface Place {
  dataset: DatasetHit;
  info: DatasetInfo | undefined;
  trail: { name: string; tree: string }[];
  files: RemoteFile[];
}

export function OpenNeuroPanel() {
  const [status, setStatus] = useState<Status>(link ? { kind: "busy", text: opening(link) } : IDLE);
  const [results, setResults] = useState<Results | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [filters, setFilters] = useState({ modality: "", sort: "relevance" as Sort });
  const form = useRef<HTMLFormElement>(null);
  // The hint is for a first open: it goes once a recording has a tab.
  const untouched = useStore((s) => s.tabs.length === 0);
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

  /** A new request to OpenNeuro's search, which stops the one before it. */
  function signal() {
    searching.current?.abort();
    searching.current = new AbortController();
    return searching.current.signal;
  }

  /** Searches with the words in the field and the filters `chosen`; with neither words nor a modality, it waits. */
  function search(chosen = filters) {
    const keywords = String(new FormData(form.current ?? undefined).get("query") ?? "").trim();
    if (!keywords && !chosen.modality) return;
    const asked: Search = { keywords, ...chosen };
    const stop = signal();
    void run(
      "Searching",
      () => searchDatasets(asked, null, stop),
      (page) => {
        setResults({ search: asked, ...page });
        setPlace(null);
      },
    );
  }

  function filter(change: Partial<typeof filters>) {
    const chosen = { ...filters, ...change };
    setFilters(chosen);
    search(chosen);
  }

  function more() {
    if (!results?.next) return;
    const { search: asked, next } = results;
    const stop = signal();
    void run(
      "Loading more datasets",
      () => searchDatasets(asked, next, stop),
      (page) =>
        setResults((r) => r && { ...r, hits: [...r.hits, ...page.hits], count: page.count, next: page.next }),
    );
  }

  /** Lists folder `trail` of `dataset`'s snapshot; `info` describes it, fetched again for another snapshot. */
  const browse = (dataset: DatasetHit, trail: Place["trail"], info?: DatasetInfo) =>
    run(
      `Listing ${trail.at(-1)?.name ?? dataset.id}`,
      () =>
        Promise.all([
          listFiles(dataset.id, dataset.tag, trail.at(-1)?.tree),
          info ?? datasetInfo(dataset.id, dataset.tag).catch(() => undefined),
        ]),
      ([files, described]) => setPlace({ dataset, info: described, trail, files }),
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
    <section className={rail.section} aria-labelledby="openneuro-heading" data-appear>
      <h2 id="openneuro-heading" className={rail.heading}>
        OpenNeuro
      </h2>
      <search className={styles.search}>
        <form
          ref={form}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            search();
          }}
        >
          <input
            type="search"
            name="query"
            className={styles.field}
            aria-label="Search OpenNeuro"
            placeholder="Search public datasets"
          />
        </form>
        <div className={styles.filters}>
          <Pick
            label="Modality"
            value={filters.modality}
            items={MODALITIES}
            onChange={(modality) => filter({ modality })}
          />
          <Pick
            label="Order"
            value={filters.sort}
            items={SORTS}
            onChange={(sort) => filter({ sort: sort as Sort })}
          />
        </div>
        <StatusLine status={status} />
      </search>
      {place ? (
        <FolderView
          place={place}
          onResults={showResults}
          onBrowse={(trail) => browse(place.dataset, trail, place.info)}
          onVersion={(tag) => browse({ ...place.dataset, tag }, [])}
          onOpen={(name) => {
            const path = [...place.trail.map((step) => step.name), name].join("/");
            const source = sourceOf(place.dataset.id, place.dataset.tag, path, place.info);
            return run(`Opening ${name}`, () => openInput(recordingInput(place.files, name, source)));
          }}
        />
      ) : results ? (
        <ResultList results={results} onBrowse={(dataset) => browse(dataset, [])} onMore={more} />
      ) : (
        untouched && (
          <p className={rail.hint}>
            Recordings stream in place from OpenNeuro, a range at a time. Try the{" "}
            <a href={DEMO} onClick={openDemo}>
              ds003029 seizure recording
            </a>
            .
          </p>
        )
      )}
    </section>
  );
}

/** A labeled choice of the search, in the house select. */
function Pick(props: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <Select.Root
      value={props.value}
      items={props.items}
      onValueChange={(value) => value !== null && props.onChange(value as string)}
    >
      <div className={controls.field}>
        <Select.Label className={controls.label}>{props.label}</Select.Label>
        <Select.Trigger className={controls.trigger}>
          <Select.Value />
          <Select.Icon>
            <ChevronDown aria-hidden />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className={controls.popup}>
            <Select.List className={controls.list}>
              {props.items.map((item) => (
                <Select.Item key={item.value} value={item.value} className={controls.item}>
                  <Select.ItemIndicator>
                    <Check aria-hidden />
                  </Select.ItemIndicator>
                  <Select.ItemText className={controls.itemText}>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
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

const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;

function ResultList(props: { results: Results; onBrowse(dataset: DatasetHit): void; onMore(): void }) {
  const { search, hits, count, next } = props.results;
  if (hits.length === 0) {
    return (
      <p className={rail.hint} data-appear>
        No public dataset matches {search.keywords ? `“${search.keywords}”` : "these filters"}.
      </p>
    );
  }
  return (
    <>
      <p className={rail.hint} data-appear>
        {hits.length < count ? `${hits.length} of ${plural(count, "dataset")}` : plural(count, "dataset")}
      </p>
      <ul className={rail.entries} aria-label="Datasets">
        {hits.map((hit) => (
          <li key={hit.id} data-appear>
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
                    {plural(hit.subjects, "subject")}
                  </>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {next && (
        <button
          type="button"
          className={`${controls.quiet} ${rail.ghost} ${rail.start}`}
          onClick={props.onMore}
          data-appear
        >
          More datasets
        </button>
      )}
    </>
  );
}

function FolderView(props: {
  place: Place;
  onResults(): void;
  onBrowse(trail: Place["trail"]): void;
  onVersion(tag: string): void;
  onOpen(name: string): void;
}) {
  const { dataset, info, trail, files } = props.place;
  const folders = files.filter((file) => file.directory);
  const recordings = files.filter((file) => !file.directory && RECORDING.test(file.filename));
  const others = files.length - folders.length - recordings.length;
  const here = trail.at(-1)?.name ?? dataset.id;
  const remote = {
    tag: dataset.tag,
    path: [dataset.id, ...trail.map((step) => step.name)].join("/"),
    tree: trail.at(-1)?.tree,
  };
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
      <About dataset={dataset} info={info} onVersion={props.onVersion} />
      <RemoteBatch key={`${remote.tag}/${remote.path}`} root={dataset.id} remote={remote} info={info} />
      <ul className={rail.entries} aria-label={`Files in ${here}`}>
        {folders.map((folder) => (
          <li key={folder.id} data-appear>
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
          <li key={file.id} data-appear>
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
        <p className={rail.hint} data-appear>
          {others} other {others === 1 ? "file" : "files"}
        </p>
      )}
    </>
  );
}

/** The most authors the description names before "and N more". */
const AUTHORS = 3;

/** The snapshot's description: name, version (another is picked here), authors, license, DOI, citation, README. */
function About(props: { dataset: DatasetHit; info: DatasetInfo | undefined; onVersion(tag: string): void }) {
  const { dataset, info } = props;
  const [copied, setCopied] = useState(false);
  const tags = info && info.tags.length > 0 ? info.tags : [dataset.tag];
  const citation = citationOf(dataset.id, dataset.tag, info);
  const authors = info?.authors ?? [];
  const named =
    authors.length > AUTHORS
      ? `${authors.slice(0, AUTHORS).join(", ")} and ${authors.length - AUTHORS} more`
      : authors.join(", ");
  function copy() {
    navigator.clipboard.writeText(citation).then(
      () => setCopied(true),
      () => {},
    );
  }
  return (
    <section className={styles.about} aria-label="Dataset" data-appear>
      <p className={styles.title}>{info?.name ?? dataset.name}</p>
      <Pick
        label="Version"
        value={dataset.tag}
        items={tags.map((tag) => ({ value: tag, label: tag === tags[0] ? `${tag}, latest` : tag }))}
        onChange={props.onVersion}
      />
      {info && (
        <dl className={styles.facts}>
          {named && (
            <>
              <dt>Authors</dt>
              <dd>{named}</dd>
            </>
          )}
          {info.license && (
            <>
              <dt>License</dt>
              <dd>{info.license}</dd>
            </>
          )}
          {info.doi && (
            <>
              <dt>DOI</dt>
              <dd>
                <a href={`https://doi.org/${info.doi}`} target="_blank" rel="noreferrer">
                  {info.doi}
                </a>
              </dd>
            </>
          )}
        </dl>
      )}
      <p className={styles.citation}>{citation}</p>
      {info?.acknowledge && <p className={rail.hint}>{info.acknowledge}</p>}
      <button type="button" className={`${controls.quiet} ${rail.ghost} ${rail.start}`} onClick={copy}>
        {copied ? "Citation copied" : "Copy the citation"}
      </button>
      {info?.readme && (
        <details className={styles.readme}>
          <summary>README</summary>
          <pre>{info.readme}</pre>
        </details>
      )}
    </section>
  );
}

/**
 * The batch on a folder of a snapshot: Find recordings walks the folder and those below it as `ddalab batch` would,
 * then "Run on all N" runs them as a local folder's batch does, one streamed recording at a time.
 */
function RemoteBatch(props: { root: string; remote: Required<BatchRecord>["remote"]; info?: DatasetInfo }) {
  const [found, setFound] = useState<RemoteRecording[] | "walking" | Error | null>(null);
  function walk() {
    setFound("walking");
    walkRecordings(props.root, props.remote.tag, props.remote, props.info).then(setFound, (error: unknown) =>
      setFound(error instanceof Error ? error : new Error(String(error))),
    );
  }
  return (
    <div className={styles.batch}>
      {found === null || found === "walking" ? (
        <button
          type="button"
          className={`${controls.quiet} ${rail.ghost} ${rail.start}`}
          aria-disabled={found === "walking" || undefined}
          onClick={() => found === null && walk()}
        >
          {found === "walking" ? "Finding recordings" : "Find recordings to run on"}
        </button>
      ) : found instanceof Error ? (
        <p role="alert" className={rail.error}>
          {found.message}
        </p>
      ) : found.length === 0 ? (
        <p className={rail.hint}>No EEG or iEEG recording here or below for a batch.</p>
      ) : (
        <BatchAction recordings={found} root={props.root} remote={props.remote} />
      )}
      <BatchProgressView root={props.root} />
    </div>
  );
}
