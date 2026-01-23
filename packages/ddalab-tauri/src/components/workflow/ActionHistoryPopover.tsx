"use client";

import { useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBufferedActions } from "@/hooks/useWorkflowQueries";
import type { BufferedAction, WorkflowAction } from "@/types/workflow";
import {
  FileAudio,
  Layers,
  Settings2,
  Play,
  Download,
  Clock,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionHistoryPopoverProps {
  children: React.ReactNode;
  enabled?: boolean;
}

function getActionIcon(action: WorkflowAction) {
  switch (action.type) {
    case "LoadFile":
    case "CloseFile":
    case "SwitchActiveFile":
      return FileAudio;
    case "SelectChannels":
    case "DeselectChannels":
    case "SelectAllChannels":
    case "ClearChannelSelection":
    case "FilterChannels":
      return Layers;
    case "SetDDAParameters":
    case "SelectDDAVariants":
    case "SetDelayList":
    case "SetModelParameters":
      return Settings2;
    case "RunDDAAnalysis":
      return Play;
    case "ExportResults":
    case "ExportPlot":
      return Download;
    default:
      return Clock;
  }
}

function getActionLabel(action: WorkflowAction): string {
  switch (action.type) {
    case "LoadFile":
      return "Load File";
    case "CloseFile":
      return "Close File";
    case "SwitchActiveFile":
      return "Switch File";
    case "SelectChannels":
      return "Select Channels";
    case "DeselectChannels":
      return "Deselect Channels";
    case "SelectAllChannels":
      return "Select All Channels";
    case "ClearChannelSelection":
      return "Clear Selection";
    case "FilterChannels":
      return "Filter Channels";
    case "SetTimeWindow":
      return "Set Time Window";
    case "SetChunkWindow":
      return "Set Chunk Window";
    case "ApplyPreprocessing":
      return "Apply Preprocessing";
    case "SetDDAParameters":
      return "Set DDA Parameters";
    case "SelectDDAVariants":
      return "Select Variants";
    case "SetDelayList":
      return "Set Delays";
    case "SetModelParameters":
      return "Set Model Parameters";
    case "RunDDAAnalysis":
      return "Run DDA Analysis";
    case "AddAnnotation":
      return "Add Annotation";
    case "RemoveAnnotation":
      return "Remove Annotation";
    case "TransformData":
      return "Transform Data";
    case "GeneratePlot":
      return "Generate Plot";
    case "ExportResults":
      return "Export Results";
    case "ExportPlot":
      return "Export Plot";
    case "SaveAnalysisResult":
      return "Save Result";
    case "LoadAnalysisFromHistory":
      return "Load from History";
    case "CompareAnalyses":
      return "Compare Analyses";
  }
}

function getActionDetails(action: WorkflowAction): string | null {
  switch (action.type) {
    case "LoadFile":
      return action.data.path.split(/[/\\]/).pop() || action.data.path;
    case "SelectChannels":
      return `${action.data.channel_indices.length} channels`;
    case "SetDDAParameters":
      return `Window: ${action.data.window_length}, Step: ${action.data.window_step}`;
    case "SelectDDAVariants":
      return action.data.variants.join(", ");
    case "SetDelayList":
      return `${action.data.delays.length} delays`;
    case "RunDDAAnalysis":
      return action.data.channel_selection
        ? `${action.data.channel_selection.length} channels`
        : null;
    case "ExportResults":
      return action.data.format;
    case "SetTimeWindow":
      return `${action.data.start.toFixed(1)}s - ${action.data.end.toFixed(1)}s`;
    default:
      return null;
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ActionItem({ action }: { action: BufferedAction }) {
  const Icon = getActionIcon(action.action);
  const label = getActionLabel(action.action);
  const details = getActionDetails(action.action);

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 hover:bg-muted/50 rounded-sm transition-colors">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{label}</span>
            {action.auto_generated && (
              <span className="text-[9px] text-muted-foreground bg-muted px-1 rounded">
                auto
              </span>
            )}
          </div>
          {details && (
            <p className="text-[10px] text-muted-foreground truncate">
              {details}
            </p>
          )}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {formatTime(action.timestamp)}
      </span>
    </div>
  );
}

export function ActionHistoryPopover({
  children,
  enabled = true,
}: ActionHistoryPopoverProps) {
  const { data: actions = [], isLoading } = useBufferedActions({
    enabled,
    lastN: 50,
    refetchInterval: 3000,
  });

  const reversedActions = useMemo(
    () => [...actions].reverse(),
    [actions],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h4 className="text-sm font-medium">Action History</h4>
          <span className="text-xs text-muted-foreground">
            {actions.length} action{actions.length !== 1 ? "s" : ""}
          </span>
        </div>
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-20">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : reversedActions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-20 text-center px-4">
              <Clock className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No actions recorded</p>
              <p className="text-xs text-muted-foreground/70">
                Actions will appear here when recording
              </p>
            </div>
          ) : (
            <div className="py-1">
              {reversedActions.map((action, index) => (
                <ActionItem key={`${action.timestamp}-${index}`} action={action} />
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
