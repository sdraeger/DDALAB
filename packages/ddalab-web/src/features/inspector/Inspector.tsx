// The inspector: the active result's provenance, the active recording's facts and scan, and its channels by electrode
// group, chosen for analysis.
import { lazy, memo, Suspense, useCallback, useMemo, useState, useTransition } from "react";
import { closeRecording } from "../../app/recordings";
import type { ScanState } from "../../core/protocol";
import type { RecordingInfo } from "../../core/types";
import { activeRecording, selectChannels, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import { DdaSettings } from "../analysis/DdaSettings";
import { RunBar } from "../analysis/RunBar";
import { electrodeGroups, type Group } from "./groups";
import styles from "./Inspector.module.css";

const Provenance = lazy(() => import("../history/Provenance"));
const Annotations = lazy(() => import("../annotations/AnnotationList"));

/** The height of a channel row in CSS px; the list renders only the rows in view. */
const ROW = 28;
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 6;

export function Inspector() {
  const id = useStore((s) => s.activeRecordingId);
  const recording = useStore(activeRecording);
  const result = useStore((s) => s.activeResultId);
  // The active result's provenance comes first; the result need not be of the open recording.
  const provenance = result && (
    <Suspense fallback={null}>
      <Provenance />
    </Suspense>
  );
  if (!id || !recording) {
    return (
      <section aria-label="Inspector" className={styles.inspector}>
        {provenance}
        <p className={styles.empty}>Open a recording to see its channels.</p>
      </section>
    );
  }
  const { info, scan, analysis_channels } = recording;
  return (
    <section aria-label="Inspector" className={styles.inspector}>
      {provenance}
      <header className={styles.header}>
        <h2 className={styles.title}>{info.input_files[0]}</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Format</dt>
            <dd>{info.format}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{info.duration_s} s</dd>
          </div>
          <div>
            <dt>Sample rate</dt>
            <dd>{info.sample_rate_hz} Hz</dd>
          </div>
        </dl>
        <Scan scan={scan} />
        {info.warnings.length > 0 && (
          <ul aria-label="Warnings" className={styles.warnings}>
            {info.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </header>
      <Channels key={id} info={info} analysis={analysis_channels} selected={recording.selectedChannels} />
      <Suspense fallback={null}>
        <Annotations key={id} recordingId={id} />
      </Suspense>
      <Suspense fallback={null}>
        <DdaSettings recordingId={id} />
      </Suspense>
      <footer className={styles.footer}>
        <button type="button" className={controls.button} onClick={() => closeRecording(id)}>
          Close recording
        </button>
      </footer>
      <Suspense fallback={null}>
        <RunBar recordingId={id} />
      </Suspense>
    </section>
  );
}

function Scan({ scan }: { scan: ScanState }) {
  const percent = scan.totalRows === 0 ? 100 : Math.floor((100 * scan.scannedRows) / scan.totalRows);
  return (
    <>
      {scan.notice ? (
        <p className={styles.note}>{scan.notice}</p>
      ) : (
        <p className={styles.scan}>
          <span>Overview {percent}%</span>
          <progress aria-label="Overview" max={100} value={percent} />
        </p>
      )}
      {scan.error && (
        <p role="alert" className={styles.error}>
          {scan.error}
        </p>
      )}
    </>
  );
}

/** Kept apart from the scan, which re-renders the inspector ten times a second while it runs. */
const Channels = memo(function Channels(props: {
  info: RecordingInfo;
  analysis: number[];
  selected: number[];
}) {
  const { info, analysis, selected } = props;
  const labels = useMemo(() => analysis.map((i) => info.channels[i].label), [analysis, info]);
  const { groups, groupOf } = useMemo(() => electrodeGroups(labels), [labels]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [filtering, startTransition] = useTransition();
  const chosen = useMemo(() => new Set(selected), [selected]);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = labels.map((_, i) => i);
    return needle ? all.filter((i) => labels[i].toLowerCase().includes(needle)) : all;
  }, [filter, labels]);
  // Signals at another rate than the display channels are not analyzed or displayed.
  const analyzed = new Set(analysis);
  const others = info.channels.flatMap((channel, i) =>
    channel.kind === "Signal" && !analyzed.has(i) ? [{ channel, i }] : [],
  );
  return (
    <div className={styles.channels}>
      <h3 className={styles.heading}>
        Channels <span className={styles.count}>{`${selected.length} of ${labels.length} chosen`}</span>
      </h3>
      <ul aria-label="Electrode groups" className={styles.groups}>
        {groups.map((group) => (
          <GroupRow key={group.name} group={group} chosen={chosen} />
        ))}
      </ul>
      <input
        type="search"
        className={styles.search}
        aria-label="Search channels"
        placeholder="Search channels"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          startTransition(() => setFilter(event.target.value));
        }}
      />
      <ChannelList
        shown={shown}
        labels={labels}
        info={info}
        analysis={analysis}
        tints={groups.map((g) => g.tint)}
        groupOf={groupOf}
        chosen={chosen}
        stale={filtering}
      />
      {others.length > 0 && (
        <div className={styles.others}>
          <p>Not analyzed or displayed (another sample rate):</p>
          <ul aria-label="Not analyzed">
            {others.map(({ channel, i }) => (
              <li key={i}>
                {channel.label} ({channel.sample_rate_hz} Hz)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

function GroupRow({ group, chosen }: { group: Group; chosen: Set<number> }) {
  const count = group.members.filter((c) => chosen.has(c)).length;
  return (
    <li>
      <label className={styles.group}>
        <input
          type="checkbox"
          aria-label={`Select group ${group.name}`}
          checked={count === group.members.length}
          ref={(element) => {
            if (element) element.indeterminate = count > 0 && count < group.members.length;
          }}
          onChange={(event) => selectChannels(group.members, event.target.checked)}
        />
        <span className={styles.swatch} style={{ background: group.tint }} />
        <span className={styles.acronym}>{group.name}</span>
        <span className={styles.count}>{`${count} of ${group.members.length}`}</span>
      </label>
    </li>
  );
}

function ChannelList(props: {
  shown: number[];
  labels: string[];
  info: RecordingInfo;
  analysis: number[];
  tints: string[];
  groupOf: Int32Array;
  chosen: Set<number>;
  stale: boolean;
}) {
  const { shown, labels, info, analysis, tints, groupOf, chosen } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(shown.length, Math.ceil((scrollTop + (height || 800)) / ROW) + OVERSCAN);
  return (
    <div
      className={styles.scroller}
      data-stale={props.stale || undefined}
      // Page keys scroll this list instead of paging the recording.
      data-own-keys
      ref={measure}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <ul aria-label="Channels" className={styles.list} style={{ height: shown.length * ROW }}>
        {shown.slice(first, last).map((channel, k) => {
          const i = first + k;
          const { kind, bids_type, bids_status } = info.channels[analysis[channel]];
          return (
            <li
              key={channel}
              className={styles.row}
              aria-setsize={shown.length}
              aria-posinset={i + 1}
              style={{ transform: `translateY(${i * ROW}px)` }}
            >
              <label className={styles.channel}>
                <input
                  type="checkbox"
                  aria-label={`Select ${labels[channel]}`}
                  checked={chosen.has(channel)}
                  onChange={(event) => selectChannels([channel], event.target.checked)}
                />
                <span className={styles.swatch} style={{ background: tints[groupOf[channel]] }} />
                <span className={styles.label}>{labels[channel]}</span>
              </label>
              <span className={styles.kind}>{bids_type ?? kind}</span>
              {bids_status && (
                <span className={bids_status === "bad" ? styles.bad : styles.kind}>{bids_status}</span>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className={styles.empty}>No channel matches.</p>}
    </div>
  );
}
