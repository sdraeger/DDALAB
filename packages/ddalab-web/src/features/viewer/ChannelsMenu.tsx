// The channels and rows popover in the scale band: rows on screen, viewed channel/group toggles and quick DDA picks,
// right beside Reference and Filter so users can control viewed and analyzed channels even with the inspector closed.
import { Popover } from "@base-ui/react/popover";
import { useMemo } from "react";
import {
  activeRecording,
  clearSelectedChannels,
  rowChannels,
  selectAllChannels,
  setSelectedChannels,
  setView,
  setViewedChannels,
  showChosenOnly,
  toggleViewedChannels,
  useStore,
} from "../../store/store";
import controls from "../../styles/controls.module.css";
import { channelLabels } from "../inspector/groups";
import styles from "./Viewer.module.css";

const ROW_PRESETS = [4, 8, 12, 16, 24, 32];
const MAX_GROUP_CHIPS = 12;

export function ChannelsMenu() {
  const id = useStore((s) => s.activeRecordingId);
  const info = useStore((s) => activeRecording(s)?.info);
  const analysis = useStore((s) => activeRecording(s)?.analysis_channels);
  const selected = useStore((s) => activeRecording(s)?.selectedChannels);
  const viewed = useStore((s) => activeRecording(s)?.viewedChannels ?? null);
  const rowCount = useStore((s) => s.view.rowCount);
  const firstChannel = useStore((s) => s.view.firstChannel);
  const chosenOnly = useStore((s) => s.view.chosenOnly);

  const { groups } = useMemo(() => channelLabels(info?.channels ?? [], analysis ?? []), [analysis, info]);

  if (!id || !info || !analysis || !selected) return null;

  const total = analysis.length;
  const order = rowChannels(
    { chosenOnly },
    { analysis_channels: analysis, selectedChannels: selected, viewedChannels: viewed },
  );
  const visibleSet = new Set(order);
  const customView = viewed !== null && !chosenOnly;
  const onScreenCount = Math.min(rowCount, order.length);
  const summary = chosenOnly
    ? `${selected.length} chosen`
    : customView
      ? `${viewed.length} of ${total}`
      : `${Math.min(rowCount, total)} of ${total}`;

  const presets = ROW_PRESETS.filter((n) => n < total);
  const showAllRowsChip = total > 0 && total <= 64;

  const selectOnScreen = () => {
    const onScreen = order.slice(firstChannel, firstChannel + rowCount);
    setSelectedChannels(onScreen);
  };

  return (
    <div className={styles.filterReadout}>
      <dt>Channels</dt>
      <dd>
        <Popover.Root>
          <Popover.Trigger
            className={styles.filterButton}
            data-on={chosenOnly || customView}
            aria-label={`Viewed channels: ${summary}`}
          >
            {summary}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="top" sideOffset={8}>
              <Popover.Popup
                className={`${controls.panel} ${styles.filterPanel}`}
                aria-label="Channels and rows"
              >
                <fieldset className={styles.bands}>
                  <legend className={controls.label}>Rows on screen</legend>
                  {presets.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={controls.button}
                      aria-pressed={rowCount === n}
                      onClick={() => setView({ rowCount: n })}
                    >
                      {n}
                    </button>
                  ))}
                  {showAllRowsChip && (
                    <button
                      type="button"
                      className={controls.button}
                      aria-pressed={rowCount >= total}
                      onClick={() => setView({ rowCount: total })}
                    >
                      All ({total})
                    </button>
                  )}
                </fieldset>
                <fieldset className={styles.bands}>
                  <legend className={controls.label}>View</legend>
                  <button
                    type="button"
                    className={controls.button}
                    aria-pressed={!chosenOnly && viewed === null}
                    onClick={() => setViewedChannels(null)}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={controls.button}
                    aria-pressed={chosenOnly}
                    disabled={selected.length === 0}
                    onClick={() => showChosenOnly(!chosenOnly)}
                  >
                    Chosen only
                  </button>
                  <button
                    type="button"
                    className={controls.button}
                    aria-pressed={!chosenOnly && viewed !== null && viewed.length === 0}
                    onClick={() => setViewedChannels([])}
                  >
                    None
                  </button>
                </fieldset>
                {groups.length > 1 && groups.length <= MAX_GROUP_CHIPS && (
                  <fieldset className={styles.bands}>
                    <legend className={controls.label}>Groups</legend>
                    {groups.map((group) => {
                      const shownInGroup = group.members.some((c) => visibleSet.has(c));
                      return (
                        <button
                          key={group.name}
                          type="button"
                          className={controls.button}
                          aria-pressed={shownInGroup}
                          title={`Toggle group ${group.name} in waveform (Alt-click to solo)`}
                          onClick={(event) => {
                            if (event.altKey) setViewedChannels(group.members);
                            else toggleViewedChannels(group.members, !shownInGroup);
                          }}
                        >
                          {group.name}
                        </button>
                      );
                    })}
                  </fieldset>
                )}
                <fieldset className={styles.bands}>
                  <legend className={controls.label}>For DDA</legend>
                  <button
                    type="button"
                    className={controls.button}
                    disabled={selected.length === total || total === 0}
                    onClick={selectAllChannels}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className={controls.button}
                    disabled={selected.length === 0}
                    onClick={clearSelectedChannels}
                  >
                    Select none
                  </button>
                  <button
                    type="button"
                    className={controls.button}
                    disabled={onScreenCount === 0}
                    onClick={selectOnScreen}
                  >
                    On screen ({onScreenCount})
                  </button>
                  {customView && viewed.length > 0 && (
                    <button
                      type="button"
                      className={controls.button}
                      onClick={() => setSelectedChannels(viewed)}
                    >
                      Use viewed ({viewed.length})
                    </button>
                  )}
                </fieldset>
                <p className={styles.filterNote}>
                  Click any channel label in the waveform gutter to toggle it for DDA (Shift-click for a
                  range). Alt-click a group or eye icon to solo it in the viewer.
                </p>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </dd>
    </div>
  );
}
