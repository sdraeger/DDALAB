// The inspector: the active result's provenance, the active recording's facts and scan, and its channels by electrode
// group, chosen for analysis and toggled in the waveform view.
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import { lazy, memo, Suspense, useCallback, useId, useMemo, useRef, useState, useTransition } from "react";
import { MiddleText } from "../../app/MiddleText";
import { closeRecording, engine } from "../../app/recordings";
import { assessChannelQuality, type ChannelQuality, qualitySummary } from "../../core/quality";
import type { RecordingInfo } from "../../core/types";
import { decimal } from "../../core/words";
import {
  activeRecording,
  clearSelectedChannels,
  rowChannels,
  selectAllChannels,
  selectChannels,
  setSelectedChannels,
  setViewedChannels,
  showChosenOnly,
  toggleViewedChannels,
  useStore,
} from "../../store/store";
import { tabOf, updateTab } from "../../store/tabs";
import controls from "../../styles/controls.module.css";
import { useHit } from "../../styles/media";
import { RunBar } from "../analysis/RunBar";
import { Streamed } from "../openneuro/Streamed";
import { channelLabels, type Group, shownLabel } from "./groups";
import styles from "./Inspector.module.css";

const DdaSettings = lazy(() => import("../analysis/DdaSettings").then((m) => ({ default: m.DdaSettings })));
const Provenance = lazy(() => import("../history/Provenance"));
const Annotations = lazy(() => import("../annotations/AnnotationList"));
const MetadataEditor = lazy(() => import("./MetadataEditor"));

/** The electrode groups listed before "Show all". */
const GROUPS_SHOWN = 8;
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 6;

// Not memoized: the reveal of a hidden inspector (Shell's Activity) must render it again, or a lazy section that
// suspended while hidden arrives a moment later and shifts the panel.
export function Inspector() {
  const id = useStore((s) => s.activeRecordingId);
  // Each part on its own: a scan report replaces the recording but keeps these, and only Scan follows it.
  const fingerprint = useStore((s) => activeRecording(s)?.fingerprint);
  const info = useStore((s) => activeRecording(s)?.info);
  const analysis = useStore((s) => activeRecording(s)?.analysis_channels);
  const selected = useStore((s) => activeRecording(s)?.selectedChannels);
  const viewed = useStore((s) => activeRecording(s)?.viewedChannels ?? null);
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
            <dd>{decimal(info.duration_s)} s</dd>
          </div>
          <div>
            <dt>Sample rate</dt>
            <dd>{decimal(info.sample_rate_hz)} Hz</dd>
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
      <Channels
        key={id}
        recordingId={id}
        fingerprint={fingerprint}
        info={info}
        analysis={analysis}
        selected={selected}
        viewed={viewed}
      />
      <Suspense fallback={null}>
        <Annotations key={id} recordingId={id} />
      </Suspense>
      <Suspense fallback={null}>
        <DdaSettings recordingId={id} />
      </Suspense>
      <footer className={styles.footer}>
        <Suspense fallback={null}>
          <MetadataEditor
            recordingId={id}
            fileName={info.input_files[0]}
            sidecar={info.input_files.some((f) => f.endsWith("_channels.tsv"))}
          />
        </Suspense>
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
  recordingId: string;
  fingerprint: string;
  info: RecordingInfo;
  analysis: number[];
  selected: number[];
  viewed: number[] | null;
}) {
  const { recordingId, fingerprint, info, analysis, selected, viewed } = props;
  const chosenOnly = useStore((s) => s.view.chosenOnly);
  const { labels, groups, groupOf } = useMemo(() => channelLabels(info.channels, analysis), [analysis, info]);
  // The search is the tab's: it comes back when the tab does.
  const [query, setQuery] = useState(() => tabOf(fingerprint)?.channelQuery ?? "");
  const [filter, setFilter] = useState(query);
  const [filtering, startTransition] = useTransition();
  const [quality, setQuality] = useState<ChannelQuality[] | null>(null);
  const [checkingQuality, setCheckingQuality] = useState(false);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const visibleOrder = useMemo(
    () =>
      rowChannels(
        { chosenOnly },
        { analysis_channels: analysis, selectedChannels: selected, viewedChannels: viewed },
      ),
    [analysis, chosenOnly, selected, viewed],
  );
  const visibleSet = useMemo(() => new Set(visibleOrder), [visibleOrder]);
  // Past GROUPS_SHOWN the group rows collapse: the channel list, the annotations and the settings stay in reach.
  const [allGroups, setAllGroups] = useState(false);
  const groupsId = useId();
  const trimmed = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    const all = labels.map((_, i) => i);
    return trimmed ? all.filter((i) => labels[i].toLowerCase().includes(trimmed)) : all;
  }, [trimmed, labels]);
  const shownChosenCount = useMemo(
    () => (trimmed ? shown.filter((c) => chosen.has(c)).length : selected.length),
    [trimmed, shown, chosen, selected.length],
  );
  const flaggedChannels = useMemo(
    () => (quality ?? []).filter((q) => q.flags.length > 0).map((q) => q.channel),
    [quality],
  );
  const checkQuality = useCallback(() => {
    if (checkingQuality || info.sample_count === 0 || analysis.length === 0) return;
    setCheckingQuality(true);
    const rows = Math.min(info.sample_count, Math.max(256, Math.round(info.sample_rate_hz * 10)));
    const row0 = Math.max(0, Math.floor((info.sample_count - rows) / 2));
    engine
      .raw(recordingId, row0, rows)
      .then((buf) => setQuality(assessChannelQuality(buf, analysis.length, info.sample_rate_hz)))
      .catch(() => setQuality(null))
      .finally(() => setCheckingQuality(false));
  }, [analysis.length, checkingQuality, info.sample_count, info.sample_rate_hz, recordingId]);

  const selectAllAction = () => {
    if (trimmed) selectChannels(shown, true);
    else selectAllChannels();
  };
  const selectNoneAction = () => {
    if (trimmed) selectChannels(shown, false);
    else clearSelectedChannels();
  };
  const invertAction = () => {
    if (trimmed) {
      const next = new Set(selected);
      for (const c of shown) {
        if (next.has(c)) next.delete(c);
        else next.add(c);
      }
      setSelectedChannels([...next]);
    } else {
      const next: number[] = [];
      for (let i = 0; i < labels.length; i++) {
        if (!chosen.has(i)) next.push(i);
      }
      setSelectedChannels(next);
    }
  };
  const pickViewedAction = () => {
    const state = useStore.getState();
    const rec = state.recordings[recordingId];
    if (!rec) return;
    if (rec.viewedChannels !== undefined && rec.viewedChannels !== null && !state.view.chosenOnly) {
      setSelectedChannels(rec.viewedChannels);
      return;
    }
    // Otherwise pick the channels currently visible on screen in the waveform window.
    const order = rowChannels(state.view, rec);
    const onScreen = order.slice(state.view.firstChannel, state.view.firstChannel + state.view.rowCount);
    setSelectedChannels(onScreen);
  };

  // Signals at another rate than the display channels are not analyzed or displayed.
  const analyzed = new Set(analysis);
  const others = info.channels.flatMap((channel, i) =>
    channel.kind === "Signal" && !analyzed.has(i) ? [{ channel, i }] : [],
  );
  const customView = viewed !== null && !chosenOnly;
  const allTargetSelected = trimmed
    ? shown.length > 0 && shownChosenCount === shown.length
    : selected.length === labels.length && labels.length > 0;
  const noneTargetSelected = shownChosenCount === 0;
  return (
    <div className={styles.channels}>
      <h3 className={styles.heading}>
        Channels{" "}
        <span className={styles.count}>
          {`${selected.length} of ${labels.length} for DDA`}
          {customView ? ` · ${viewed.length} viewed` : ""}
        </span>
      </h3>
      <fieldset className={styles.quickBar} aria-label="DDA channel selection">
        <span className={styles.quickLabel}>DDA</span>
        <button
          type="button"
          className={controls.quiet}
          aria-label={trimmed ? `All matching (${shown.length}) for DDA` : "All channels for DDA"}
          disabled={allTargetSelected || labels.length === 0}
          onClick={selectAllAction}
        >
          {trimmed ? `All matching (${shown.length})` : "All"}
        </button>
        <button
          type="button"
          className={controls.quiet}
          aria-label={trimmed ? "Clear matching channels from DDA" : "None — clear DDA channels"}
          disabled={noneTargetSelected}
          onClick={selectNoneAction}
        >
          {trimmed ? "Clear matching" : "None"}
        </button>
        <button
          type="button"
          className={controls.quiet}
          disabled={trimmed ? shown.length === 0 : labels.length === 0}
          onClick={invertAction}
        >
          Invert
        </button>
        <button
          type="button"
          className={controls.quiet}
          disabled={customView ? viewed.length === 0 : labels.length === 0}
          title={
            customView
              ? "Set DDA channels to the currently viewed subset"
              : "Set DDA channels to the channels currently visible on screen"
          }
          onClick={pickViewedAction}
        >
          {customView ? "Use viewed" : "On screen"}
        </button>
      </fieldset>
      <div className={styles.channelActions}>
        <ChosenOnly chosen={selected.length} />
        {info.sample_count > 0 && analysis.length > 0 && (
          <button
            type="button"
            className={`${controls.quiet} ${styles.qualityButton}`}
            disabled={checkingQuality}
            onClick={checkQuality}
          >
            {checkingQuality ? "Checking…" : quality ? "Recheck quality" : "Check quality"}
          </button>
        )}
      </div>
      {customView && (
        <p className={styles.viewNote} aria-live="polite" data-appear>
          <span>{`Waveform showing ${viewed.length} of ${labels.length}.`}</span>
          <button type="button" className={controls.quiet} onClick={() => setViewedChannels(null)}>
            Show all
          </button>
        </p>
      )}
      {quality && (
        <p className={styles.qualityNote} aria-live="polite" data-appear>
          {flaggedChannels.length === 0 ? (
            "No line-noise, flatline, or clipping flags."
          ) : (
            <>
              <span>{`${flaggedChannels.length} flagged (non-destructive).`}</span>
              <button
                type="button"
                className={controls.quiet}
                onClick={() => selectChannels(flaggedChannels, false)}
              >
                Exclude flagged
              </button>
            </>
          )}
        </p>
      )}
      <ul id={groupsId} aria-label="Electrode groups" className={styles.groups}>
        {(allGroups ? groups : groups.slice(0, GROUPS_SHOWN)).map((group) => (
          <GroupRow key={group.name} group={group} chosen={chosen} visible={visibleSet} />
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
        visible={visibleSet}
        quality={quality}
        stale={filtering}
      />
      {others.length > 0 && (
        <div className={styles.others} data-appear>
          <p>Not analyzed or displayed (another sample rate):</p>
          <ul aria-label="Not analyzed">
            {others.map(({ channel, i }) => (
              <li key={i}>
                {shownLabel(channel.label, i)} ({decimal(channel.sample_rate_hz)} Hz)
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

function GroupRow({ group, chosen, visible }: { group: Group; chosen: Set<number>; visible: Set<number> }) {
  const count = group.members.filter((c) => chosen.has(c)).length;
  const shownCount = group.members.filter((c) => visible.has(c)).length;
  const anyVisible = shownCount > 0;
  return (
    <li className={styles.groupItem}>
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
      <button
        type="button"
        className={styles.eyeButton}
        aria-label={
          anyVisible ? `Hide group ${group.name} from waveform` : `Show group ${group.name} in waveform`
        }
        aria-pressed={anyVisible}
        data-hidden={!anyVisible || undefined}
        title={
          anyVisible
            ? `Hide group ${group.name} from waveform (Alt-click to view only this group)`
            : `Show group ${group.name} in waveform (Alt-click to view only this group)`
        }
        onClick={(event) => {
          if (event.altKey) setViewedChannels(group.members);
          else toggleViewedChannels(group.members, !anyVisible);
        }}
      >
        {anyVisible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
      </button>
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
  visible: Set<number>;
  quality: ChannelQuality[] | null;
  stale: boolean;
}) {
  const { shown, labels, info, analysis, tints, groupOf, chosen, visible, quality } = props;
  // The height of a channel row in CSS px (--hit); the list renders only the rows in view.
  const row = useHit().one;
  // The first row in view: a scroll renders the list when it crosses a row, which keeps this the same in between.
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  const lastClicked = useRef<number | null>(null);
  const shiftHeld = useRef(false);
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
          const isVisible = visible.has(channel);
          return (
            <li
              key={channel}
              className={styles.row}
              data-hidden={!isVisible || undefined}
              aria-setsize={shown.length}
              aria-posinset={i + 1}
              style={{ transform: `translateY(${i * row}px)` }}
            >
              <label className={styles.channel}>
                <input
                  type="checkbox"
                  aria-label={`Select ${labels[channel]}`}
                  checked={chosen.has(channel)}
                  onClick={(event) => {
                    shiftHeld.current = event.shiftKey;
                  }}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    if (shiftHeld.current && lastClicked.current !== null) {
                      const from = shown.indexOf(lastClicked.current);
                      const to = shown.indexOf(channel);
                      if (from >= 0 && to >= 0) {
                        const lo = Math.min(from, to);
                        const hi = Math.max(from, to);
                        selectChannels(shown.slice(lo, hi + 1), checked);
                        lastClicked.current = channel;
                        shiftHeld.current = false;
                        return;
                      }
                    }
                    selectChannels([channel], checked);
                    lastClicked.current = channel;
                    shiftHeld.current = false;
                  }}
                />
                <span className={styles.swatch} style={{ background: tints[groupOf[channel]] }} />
                <MiddleText text={labels[channel]} className={styles.label} />
              </label>
              <span className={styles.kind}>{bids_type ?? kind}</span>
              {quality?.[channel]?.flags.map((flag) => (
                <span key={flag} className={styles.bad} title={qualitySummary(quality[channel])}>
                  {flag}
                </span>
              ))}
              {bids_status && (
                <span className={bids_status === "bad" ? styles.bad : styles.kind}>{bids_status}</span>
              )}
              <button
                type="button"
                className={styles.eyeButton}
                aria-label={
                  isVisible ? `Hide ${labels[channel]} from waveform` : `Show ${labels[channel]} in waveform`
                }
                aria-pressed={isVisible}
                data-hidden={!isVisible || undefined}
                title={
                  isVisible
                    ? `Hide ${labels[channel]} from waveform (Alt-click to solo)`
                    : `Show ${labels[channel]} in waveform (Alt-click to solo)`
                }
                onClick={(event) => {
                  if (event.altKey) setViewedChannels([channel]);
                  else toggleViewedChannels([channel], !isVisible);
                }}
              >
                {isVisible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
              </button>
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
