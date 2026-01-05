import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkflowAction } from "@/types/workflow";
import { useAppStore } from "@/store/appStore";
import { toast } from "@/components/ui/toaster";

/**
 * Hook for recording workflow actions from components
 * Automatically includes file context from the app state
 */
export function useWorkflowRecording() {
  // Get active file from store for proper context tracking
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const isRecording = useAppStore(
    (state) => state.workflowRecording.isRecording,
  );

  // Track consecutive failures for back-off
  const failureCount = useRef(0);
  const lastWarningTime = useRef(0);

  const recordAction = useCallback(
    async (action: WorkflowAction) => {
      // Skip if not recording
      if (!isRecording) {
        return;
      }

      try {
        await invoke("workflow_auto_record", {
          action,
          activeFileId: selectedFile?.file_path || null,
        });

        // Reset failure count on success
        failureCount.current = 0;
      } catch (error) {
        failureCount.current += 1;

        // Only show error toast after multiple failures (avoid spam)
        // and no more than once every 10 seconds
        const now = Date.now();
        if (
          failureCount.current >= 3 &&
          now - lastWarningTime.current > 10000
        ) {
          toast.warning(
            "Recording issue",
            "Some actions may not have been recorded",
          );
          lastWarningTime.current = now;
        }

        console.error("Failed to record workflow action:", error, {
          action: action.type,
          failureCount: failureCount.current,
        });
      }
    },
    [selectedFile?.file_path, isRecording],
  );

  return {
    recordAction,

    recordLoadFile: useCallback(
      (path: string, fileType: "EDF" | "ASCII" | "CSV") => {
        return recordAction({
          type: "LoadFile",
          data: { path, file_type: fileType },
        });
      },
      [recordAction],
    ),

    recordCloseFile: useCallback(
      (fileId: string) => {
        return recordAction({
          type: "CloseFile",
          data: { file_id: fileId },
        });
      },
      [recordAction],
    ),

    recordSelectChannels: useCallback(
      (channelIndices: number[]) => {
        return recordAction({
          type: "SelectChannels",
          data: { channel_indices: channelIndices },
        });
      },
      [recordAction],
    ),

    recordDeselectChannels: useCallback(
      (channelIndices: number[]) => {
        return recordAction({
          type: "DeselectChannels",
          data: { channel_indices: channelIndices },
        });
      },
      [recordAction],
    ),

    recordSelectAllChannels: useCallback(() => {
      return recordAction({
        type: "SelectAllChannels",
      });
    }, [recordAction]),

    recordClearChannelSelection: useCallback(() => {
      return recordAction({
        type: "ClearChannelSelection",
      });
    }, [recordAction]),

    recordSetTimeWindow: useCallback(
      (start: number, end: number) => {
        return recordAction({
          type: "SetTimeWindow",
          data: { start, end },
        });
      },
      [recordAction],
    ),

    recordSetDDAParameters: useCallback(
      (
        windowLength: number,
        windowStep: number,
        ctWindowLength?: number,
        ctWindowStep?: number,
      ) => {
        return recordAction({
          type: "SetDDAParameters",
          data: {
            window_length: windowLength,
            window_step: windowStep,
            ct_window_length: ctWindowLength,
            ct_window_step: ctWindowStep,
          },
        });
      },
      [recordAction],
    ),

    recordSelectDDAVariants: useCallback(
      (variants: string[]) => {
        return recordAction({
          type: "SelectDDAVariants",
          data: { variants },
        });
      },
      [recordAction],
    ),

    recordSetDelayList: useCallback(
      (delays: number[]) => {
        return recordAction({
          type: "SetDelayList",
          data: { delays },
        });
      },
      [recordAction],
    ),

    recordSetModelParameters: useCallback(
      (dm: number, order: number, nrTau: number, encoding: number[]) => {
        return recordAction({
          type: "SetModelParameters",
          data: {
            dm,
            order,
            nr_tau: nrTau,
            encoding,
          },
        });
      },
      [recordAction],
    ),

    recordRunDDAAnalysis: useCallback(
      (
        inputId: string,
        channelSelection: number[],
        ctChannelPairs?: [number, number][],
        cdChannelPairs?: [number, number][],
      ) => {
        return recordAction({
          type: "RunDDAAnalysis",
          data: {
            input_id: inputId,
            channel_selection: channelSelection,
            ct_channel_pairs: ctChannelPairs,
            cd_channel_pairs: cdChannelPairs,
          },
        });
      },
      [recordAction],
    ),

    recordExportResults: useCallback(
      (resultId: string, format: "CSV" | "JSON" | "MAT", path: string) => {
        return recordAction({
          type: "ExportResults",
          data: { result_id: resultId, format, path },
        });
      },
      [recordAction],
    ),
  };
}
