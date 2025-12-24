/**
 * Workflow Recording Middleware for Zustand
 *
 * This middleware was simplified to avoid complex type issues.
 * Instead of automatic recording via middleware, use the useWorkflowRecording hook
 * directly in components where actions occur.
 *
 * See: src/hooks/useWorkflowRecording.ts
 * See: src/components/workflow/README.md for integration guide
 */

import { invoke } from "@tauri-apps/api/core";

export const createWorkflowAction = {
  loadFile: (path: string, fileType: "EDF" | "ASCII" | "CSV") =>
    invoke("workflow_auto_record", {
      action: {
        type: "LoadFile",
        data: { path, file_type: fileType },
      },
      activeFileId: null,
    }),

  selectChannels: (channelIndices: number[]) =>
    invoke("workflow_auto_record", {
      action: {
        type: "SelectChannels",
        data: { channel_indices: channelIndices },
      },
      activeFileId: null,
    }),

  deselectChannels: (channelIndices: number[]) =>
    invoke("workflow_auto_record", {
      action: {
        type: "DeselectChannels",
        data: { channel_indices: channelIndices },
      },
      activeFileId: null,
    }),

  selectAllChannels: () =>
    invoke("workflow_auto_record", {
      action: { type: "SelectAllChannels" },
      activeFileId: null,
    }),

  clearChannelSelection: () =>
    invoke("workflow_auto_record", {
      action: { type: "ClearChannelSelection" },
      activeFileId: null,
    }),

  setTimeWindow: (start: number, end: number) =>
    invoke("workflow_auto_record", {
      action: {
        type: "SetTimeWindow",
        data: { start, end },
      },
      activeFileId: null,
    }),

  runDDAAnalysis: (
    inputId: string,
    channelSelection: number[],
    ctChannelPairs?: [number, number][],
    cdChannelPairs?: [number, number][],
  ) =>
    invoke("workflow_auto_record", {
      action: {
        type: "RunDDAAnalysis",
        data: {
          input_id: inputId,
          channel_selection: channelSelection,
          ct_channel_pairs: ctChannelPairs,
          cd_channel_pairs: cdChannelPairs,
        },
      },
      activeFileId: null,
    }),
};
