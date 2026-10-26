// The inspector: the active result's provenance, the active recording's facts and scan, and its channels by electrode
// group, chosen for analysis.
import Check from "lucide-react/dist/esm/icons/check.mjs";
import { lazy, memo, Suspense, useCallback, useId, useMemo, useState, useTransition } from "react";
import { closeRecording } from "../../app/recordings";
import type { RecordingInfo } from "../../core/types";
import { activeRecording, selectChannels, showChosenOnly, useStore } from "../../store/store";
import { tabOf, updateTab } from "../../store/tabs";
import controls from "../../styles/controls.module.css";
import { useHit } from "../../styles/hit";
import { DdaSettings } from "../analysis/DdaSettings";
import { RunBar } from "../analysis/RunBar";
import { Streamed } from "../openneuro/Streamed";
import { electrodeGroups, type Group } from "./groups";
import styles from "./Inspector.module.css";

const Provenance = lazy(() => import("../history/Provenance"));
const Annotations = lazy(() => import("../annotations/AnnotationList"));

/** The electrode groups listed before "Show all". */
const GROUPS_SHOWN = 8;
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 6;

export function Inspector() {
  const id = useStore((s) => s.activeRecordingId);
  // Each part on its own: a scan report replaces the recording but keeps these, and only Scan follows it.
  const fingerprint = useStore((s) => activeRecording(s)?.fingerprint);
  const info = useStore((s) => activeRecording(s)?.info);
  const analysis = useStore((s) => activeRecording(s)?.analysis_channels);
  const selected = useStore((s) => activeRecording(s)?.selectedChannels);
  const result = useStore((s) => s.activeResultId);
  // The active result's provenance comes first; the result need not be of the open recording.
  const provenance = result && (
    <Suspense fallback={null}>
      <Provenance />
    </Suspense>
  );
  // Keyed by the recording: another recording's inspector mounts anew and fades in.
  if (!id || !fingerprint || !info || !analysis || !selected) {
    return (
      <section key="none" aria-label="Inspector" className={styles.inspector} data-appear>
        {provenance}
        <p className={styles.empty}>Open a recording to see its channels.</p>
      </section>
    );
  }
  return (
    <section key={id} aria-label="Inspector" className={styles.inspector} data-appear>
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
        <Scan id={id} />
        <Streamed fingerprint={fingerprint} />
        {info.warnings.length > 0 && (
          <ul aria-label="Warnings" className={styles.warnings} data-appear>
            {info.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </header>
      <Channels key={id} fingerprint={fingerprint} info={info} analysis={analysis} selected={selected} />
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

function Scan({ id }: { id: string }) {
  const scan = useStore((s) => s.recordings[id]?.scan);
  if (!scan) return null;
  const percent = scan.totalRows === 0 ? 100 : Math.floor((100 * scan.scannedRows) / scan.totalRows);
  return (
    <>
      {scan.notice ? (
        <p key="notice" className={styles.note} data-appear>
          {scan.notice}
        </p>
      ) : (
        <p key="scan" className={styles.scan}>
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

/** Memoized: a new active result re-renders the inspector, which leaves the channels as they are. */
const Channels = memo(function Channels(props: {
  fingerprint: string;
  info: RecordingInfo;
  analysis: number[];
  selected: number[];
}) {
  const { fingerprint, info, analysis, selected } = props;
  const labels = useMemo(() => analysis.map((i) => info.channels[i].label), [analysis, info]);
  const { groups, groupOf } = useMemo(() => electrodeGroups(labels), [labels]);
  // The search is the tab's: it comes back when the tab does.
  const [query, setQuery] = useState(() => tabOf(fingerprint)?.channelQuery ?? "");
  const [filter, setFilter] = useState(query);
  const [filtering, startTransition] = useTransition();
  const chosen = useMemo(() => new Set(selected), [selected]);
  // Past GROUPS_SHOWN the group rows collapse: the channel list, the annotations and the settings stay in reach.
  const [allGroups, setAllGroups] = useState(false);
  const groupsId = useId();
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
      <ChosenOnly chosen={selected.length} />
      <ul id={groupsId} aria-label="Electrode groups" className={styles.groups}>
        {(allGroups ? groups : groups.slice(0, GROUPS_SHOWN)).map((group) => (
          <GroupRow key={group.name} group={group} chosen={chosen} />
        ))}
      </ul>
      {groups.length > GROUPS_SHOWN && (
        <button
          type="button"
          className={`${controls.quiet} ${styles.more}`}
          aria-expanded={allGroups}
          aria-controls={groupsId}
          onClick={() => setAllGroups(!allGroups)}
        >
          {allGroups ? `Show the first ${GROUPS_SHOWN} groups` : `Show all ${groups.length} groups`}
        </button>
      )}
      <input
        type="search"
        className={styles.search}
        aria-label="Search channels"
        placeholder="Search channels"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          updateTab(fingerprint, { channelQuery: event.target.value });
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
        <div className={styles.others} data-appear>
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

/**
 * Shows the chosen channels alone in the waveform; a check beside the label marks it on where forced colors drop the
 * color. The check keeps its place while off and fades in, which leaves the label still.
 * With none chosen it cannot, and its note says why; the note is announced when the last channel is unchosen, which
 * turns it off.
 */
function ChosenOnly({ chosen }: { chosen: number }) {
  const on = useStore((s) => s.view.chosenOnly);
  const id = useId();
  const reason = chosen === 0 ? "No channel is chosen." : "";
  return (
    <div className={styles.chosenOnly}>
      {/* Focusable while it cannot act, which lets its reason be heard. */}
      <button
        type="button"
        className={controls.button}
        aria-pressed={on}
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? `${id}-reason` : undefined}
        onClick={() => !reason && showChosenOnly(!on)}
      >
        <Check aria-hidden className={styles.check} data-on={on || undefined} />
        Show chosen channels only
      </button>
      <span id={`${id}-reason`} className={styles.reason} aria-live="polite">
        {reason}
      </span>
    </div>
  );
}

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
  // The height of a channel row in CSS px (--hit); the list renders only the rows in view.
  const row = useHit().one;
  // The first row in view: a scroll renders the list when it crosses a row, which keeps this the same in between.
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const first = Math.max(0, top - OVERSCAN);
  // One row more than the pixel offset would need: the rows in view start anywhere within `top`.
  const last = Math.min(shown.length, top + Math.ceil((height || 800) / row) + 1 + OVERSCAN);
  return (
    <div
      className={styles.scroller}
      data-stale={props.stale || undefined}
      // Page keys scroll this list instead of paging the recording.
      data-own-keys
      ref={measure}
      onScroll={(event) => setTop(Math.floor(event.currentTarget.scrollTop / row))}
      // At rest the list shows whole rows: none half hidden at its edge under the search field. CSS snapping would
      // snap to the rendered rows only, which a jump down the virtual list leaves behind.
      onScrollEnd={(event) => {
        const element = event.currentTarget;
        const whole = Math.round(element.scrollTop / row) * row;
        if (Math.abs(whole - element.scrollTop) < 0.5) return;
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        element.scrollTo({ top: whole, behavior: reduced ? "instant" : "smooth" });
      }}
    >
      <ul aria-label="Channels" className={styles.list} style={{ height: shown.length * row }}>
        {shown.slice(first, last).map((channel, k) => {
          const i = first + k;
          const { kind, bids_type, bids_status } = info.channels[analysis[channel]];
          return (
            <li
              key={channel}
              className={styles.row}
              aria-setsize={shown.length}
              aria-posinset={i + 1}
              style={{ transform: `translateY(${i * row}px)` }}
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
      {shown.length === 0 && (
        <p className={styles.empty} data-appear>
          No channel matches.
        </p>
      )}
    </div>
  );
}
