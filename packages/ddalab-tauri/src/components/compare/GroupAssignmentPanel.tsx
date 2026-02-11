"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Shuffle, X } from "lucide-react";
import { COMPARE_COLORS } from "./CompareEntryList";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";

interface GroupAssignmentPanelProps {
  entries: ComparisonEntry[];
  groupAssignments: Record<string, "A" | "B">;
  groupLabels: { A: string; B: string };
  onAssignGroup: (analysisId: string, group: "A" | "B") => void;
  onRemoveAssignment: (analysisId: string) => void;
  onSetGroupLabel: (group: "A" | "B", label: string) => void;
  onAutoAssign: () => void;
  onClearAssignments: () => void;
}

export function GroupAssignmentPanel({
  entries,
  groupAssignments,
  groupLabels,
  onAssignGroup,
  onRemoveAssignment,
  onSetGroupLabel,
  onAutoAssign,
  onClearAssignments,
}: GroupAssignmentPanelProps) {
  const groupA = entries.filter((e) => groupAssignments[e.analysisId] === "A");
  const groupB = entries.filter((e) => groupAssignments[e.analysisId] === "B");
  const unassigned = entries.filter((e) => !groupAssignments[e.analysisId]);

  const handleUnassignedClick = useCallback(
    (analysisId: string) => {
      const targetGroup = groupA.length <= groupB.length ? "A" : "B";
      onAssignGroup(analysisId, targetGroup);
    },
    [groupA.length, groupB.length, onAssignGroup],
  );

  const handleAssignedClick = useCallback(
    (analysisId: string, currentGroup: "A" | "B") => {
      onAssignGroup(analysisId, currentGroup === "A" ? "B" : "A");
    },
    [onAssignGroup],
  );

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Group Assignment</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onAutoAssign}
          >
            <Shuffle className="h-3.5 w-3.5 mr-1.5" />
            Auto-assign
          </Button>
          {Object.keys(groupAssignments).length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onClearAssignments}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {unassigned.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">
            Unassigned ({unassigned.length}) — click to assign
          </span>
          <div className="flex flex-wrap gap-1.5">
            {unassigned.map((entry) => (
              <Badge
                key={entry.analysisId}
                variant="outline"
                className="cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleUnassignedClick(entry.analysisId)}
              >
                {entry.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GroupColumn
          group="A"
          label={groupLabels.A}
          entries={groupA}
          color={COMPARE_COLORS[0]}
          onSetLabel={(label) => onSetGroupLabel("A", label)}
          onEntryClick={(id) => handleAssignedClick(id, "A")}
          onRemoveEntry={onRemoveAssignment}
        />
        <GroupColumn
          group="B"
          label={groupLabels.B}
          entries={groupB}
          color={COMPARE_COLORS[1]}
          onSetLabel={(label) => onSetGroupLabel("B", label)}
          onEntryClick={(id) => handleAssignedClick(id, "B")}
          onRemoveEntry={onRemoveAssignment}
        />
      </div>

      {(groupA.length < 2 || groupB.length < 2) && (
        <p className="text-xs text-muted-foreground">
          Each group needs at least 2 entries for statistical testing.
        </p>
      )}
    </div>
  );
}

interface GroupColumnProps {
  group: "A" | "B";
  label: string;
  entries: ComparisonEntry[];
  color: string;
  onSetLabel: (label: string) => void;
  onEntryClick: (analysisId: string) => void;
  onRemoveEntry: (analysisId: string) => void;
}

function GroupColumn({
  group,
  label,
  entries,
  color,
  onSetLabel,
  onEntryClick,
  onRemoveEntry,
}: GroupColumnProps) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <Input
          value={label}
          onChange={(e) => onSetLabel(e.target.value)}
          className="h-7 text-xs font-semibold border-none shadow-none p-0 focus-visible:ring-0"
        />
        <Badge variant="muted" className="text-[10px] shrink-0">
          n={entries.length}
        </Badge>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2 text-center">
          No entries assigned
        </p>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <div
              key={entry.analysisId}
              className="flex items-center gap-1.5 group"
            >
              <button
                className="flex-1 text-left text-xs truncate hover:text-primary transition-colors cursor-pointer"
                onClick={() => onEntryClick(entry.analysisId)}
                title={`Click to move to other group`}
              >
                {entry.label}
              </button>
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                onClick={() => onRemoveEntry(entry.analysisId)}
                title="Unassign"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
