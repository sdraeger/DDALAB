/**
 * Workflow Recording Middleware for Zustand
 *
 * These helpers record user actions for workflow generation.
 * They silently no-op when recording is disabled (checked on backend).
 *
 * Use these in store actions and components to track user workflows.
 * The recorded actions are stored in a circular buffer and can be
 * exported to Python/Julia/Rust scripts.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Helper to safely invoke workflow recording.
 * Catches errors silently to avoid disrupting user actions.
 */
async function safeRecord(
  action: Record<string, unknown>,
  activeFileId: string | null,
): Promise<void> {
  console.log("[WorkflowRecording] Recording action:", action.type, {
    activeFileId,
    data: action.data,
  });
  try {
    await invoke("workflow_auto_record", {
      action,
      activeFileId,
    });
    console.log(
      "[WorkflowRecording] Action recorded successfully:",
      action.type,
    );
  } catch (error) {
    // Log but don't disrupt the user action
    console.error("[WorkflowRecording] Failed to record action:", error);
  }
}

export const createWorkflowAction = {
  loadFile: (
    path: string,
    fileType:
      | "EDF"
      | "ASCII"
      | "CSV"
      | "BrainVision"
      | "EEGLAB"
      | "FIF"
      | "NIfTI"
      | "XDF",
    activeFileId?: string | null,
  ) =>
    safeRecord(
      {
        type: "LoadFile",
        data: { path, file_type: fileType },
      },
      activeFileId ?? path,
    ),

  closeFile: (fileId: string) =>
    safeRecord(
      {
        type: "CloseFile",
        data: { file_id: fileId },
      },
      fileId,
    ),

  selectChannels: (channelIndices: number[], activeFileId?: string | null) =>
    safeRecord(
      {
        type: "SelectChannels",
        data: { channel_indices: channelIndices },
      },
      activeFileId ?? null,
    ),

  deselectChannels: (channelIndices: number[], activeFileId?: string | null) =>
    safeRecord(
      {
        type: "DeselectChannels",
        data: { channel_indices: channelIndices },
      },
      activeFileId ?? null,
    ),

  selectAllChannels: (activeFileId?: string | null) =>
    safeRecord({ type: "SelectAllChannels" }, activeFileId ?? null),

  clearChannelSelection: (activeFileId?: string | null) =>
    safeRecord({ type: "ClearChannelSelection" }, activeFileId ?? null),

  setTimeWindow: (start: number, end: number, activeFileId?: string | null) =>
    safeRecord(
      {
        type: "SetTimeWindow",
        data: { start, end },
      },
      activeFileId ?? null,
    ),

  setDDAParameters: (
    params: {
      windowLength: number;
      windowStep: number;
      ctWindowLength?: number;
      ctWindowStep?: number;
    },
    activeFileId?: string | null,
  ) =>
    safeRecord(
      {
        type: "SetDDAParameters",
        data: {
          window_length: params.windowLength,
          window_step: params.windowStep,
          ct_window_length: params.ctWindowLength,
          ct_window_step: params.ctWindowStep,
        },
      },
      activeFileId ?? null,
    ),

  selectDDAVariants: (variants: string[], activeFileId?: string | null) =>
    safeRecord(
      {
        type: "SelectDDAVariants",
        data: { variants },
      },
      activeFileId ?? null,
    ),

  runDDAAnalysis: (
    inputId: string,
    channelSelection: number[],
    ctChannelPairs?: [number, number][],
    cdChannelPairs?: [number, number][],
  ) =>
    safeRecord(
      {
        type: "RunDDAAnalysis",
        data: {
          input_id: inputId,
          channel_selection: channelSelection,
          ct_channel_pairs: ctChannelPairs ?? null,
          cd_channel_pairs: cdChannelPairs ?? null,
        },
      },
      inputId,
    ),

  exportResults: (
    resultId: string,
    format: "CSV" | "JSON" | "MAT",
    path: string,
  ) =>
    safeRecord(
      {
        type: "ExportResults",
        data: { result_id: resultId, format, path },
      },
      resultId,
    ),
};
