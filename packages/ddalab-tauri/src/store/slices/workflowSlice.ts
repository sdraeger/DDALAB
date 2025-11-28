/**
 * Workflow recording state slice
 */

import type {
  ImmerStateCreator,
  WorkflowSlice,
  WorkflowRecordingState,
} from "./types";

export const defaultWorkflowRecordingState: WorkflowRecordingState = {
  isRecording: false,
  currentSessionName: null,
  actionCount: 0,
  lastActionTimestamp: null,
};

export const createWorkflowSlice: ImmerStateCreator<WorkflowSlice> = (
  set,
  get,
) => ({
  workflowRecording: defaultWorkflowRecordingState,

  startWorkflowRecording: (sessionName) => {
    set((state) => {
      state.workflowRecording.isRecording = true;
      state.workflowRecording.currentSessionName =
        sessionName || `session-${Date.now()}`;
      state.workflowRecording.actionCount = 0;
      state.workflowRecording.lastActionTimestamp = Date.now();
    });
  },

  stopWorkflowRecording: () => {
    set((state) => {
      state.workflowRecording.isRecording = false;
      state.workflowRecording.currentSessionName = null;
    });
  },

  incrementActionCount: () => {
    set((state) => {
      state.workflowRecording.actionCount += 1;
      state.workflowRecording.lastActionTimestamp = Date.now();
    });
  },

  getRecordingStatus: () => {
    return get().workflowRecording;
  },
});
