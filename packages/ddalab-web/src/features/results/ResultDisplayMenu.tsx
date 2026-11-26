// Compact display options popover in the result bar: color-range scaling (Full / Robust 2–98% / Custom),
// per-row z-score normalization, heatmap row sorting (Channel / Peak activity / Electrode group), and
// B - A difference comparison against another completed result.
import { Popover } from "@base-ui/react/popover";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import { useId } from "react";
import { SelectField } from "../../app/SelectField";
import { resultName } from "../../core/history";
import { setHeatmapOptions, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Results.module.css";
import { DEFAULT_HEATMAP_OPTIONS, type RowSort, type ScaleMode } from "./resultTransform";

const SCALE_ITEMS: { value: ScaleMode; label: string }[] = [
  { value: "full", label: "Full (min–max)" },
  { value: "robust", label: "Robust (2–98%)" },
  { value: "custom", label: "Custom limits" },
];

const SORT_ITEMS: { value: RowSort; label: string }[] = [
  { value: "channel", label: "Channel order" },
  { value: "activity", label: "Peak activity" },
  { value: "group", label: "Electrode group" },
];

export function ResultDisplayMenu({ resultId, variantId }: { resultId: string; variantId: string }) {
  const opts = useStore((s) => s.heatmapOptions);
  const analyses = useStore((s) => s.analyses);
  const minId = useId();
  const maxId = useId();

  // Other completed results that carry the same variant id.
  const comparable = analyses.filter(
    (a) =>
      a.id !== resultId &&
      a.status === "complete" &&
      (a.manifest?.variants.some((v) => v.id === variantId) ??
        a.request.algorithm_selection.enabled_variants.includes(variantId)),
  );
  const compareItems = [
    { value: "", label: "None (single result)" },
    ...comparable.map((a) => ({ value: a.id, label: resultName(a) })),
  ];
  const compareValue =
    opts.compareResultId && comparable.some((a) => a.id === opts.compareResultId) ? opts.compareResultId : "";

  const activeCount =
    (opts.scaleMode !== "full" ? 1 : 0) +
    (opts.zScore ? 1 : 0) +
    (opts.sort !== "channel" ? 1 : 0) +
    (compareValue ? 1 : 0);

  return (
    <Popover.Root>
      <Popover.Trigger
        className={controls.iconButton}
        aria-label="Heatmap display options"
        title="Scale, sort, z-score, and compare"
        data-active={activeCount > 0 || undefined}
      >
        <SlidersHorizontal aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} align="end">
          <Popover.Popup className={`${controls.panel} ${styles.displayMenu}`} aria-label="Heatmap display">
            <SelectField
              label="Scale"
              value={opts.scaleMode}
              items={SCALE_ITEMS}
              onChange={(scaleMode) => setHeatmapOptions({ scaleMode })}
            />
            {opts.scaleMode === "custom" && (
              <div className={styles.customRange}>
                <label htmlFor={minId}>Min</label>
                <input
                  id={minId}
                  type="number"
                  step="any"
                  value={opts.customMin ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setHeatmapOptions({
                      customMin: e.target.value.trim() === "" || !Number.isFinite(n) ? null : n,
                    });
                  }}
                />
                <label htmlFor={maxId}>Max</label>
                <input
                  id={maxId}
                  type="number"
                  step="any"
                  value={opts.customMax ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setHeatmapOptions({
                      customMax: e.target.value.trim() === "" || !Number.isFinite(n) ? null : n,
                    });
                  }}
                />
              </div>
            )}
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={opts.zScore}
                onChange={(e) => setHeatmapOptions({ zScore: e.target.checked })}
              />
              <span>Row z-score normalization</span>
            </label>
            <SelectField
              label="Row order"
              value={opts.sort}
              items={SORT_ITEMS}
              onChange={(sort) => setHeatmapOptions({ sort })}
            />
            {comparable.length > 0 && (
              <SelectField
                label="Compare (B − A)"
                value={compareValue}
                items={compareItems}
                onChange={(id) => setHeatmapOptions({ compareResultId: id || null })}
              />
            )}
            {activeCount > 0 && (
              <button
                type="button"
                className={controls.quiet}
                onClick={() => setHeatmapOptions(DEFAULT_HEATMAP_OPTIONS)}
              >
                Reset display
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
