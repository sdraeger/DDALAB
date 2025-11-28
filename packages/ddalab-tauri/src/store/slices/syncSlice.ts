/**
 * Sync state slice
 */

import type { ImmerStateCreator, SyncSlice, SyncState } from "./types";

export const defaultSyncState: SyncState = {
  isConnected: false,
  isLoading: false,
  error: null,
  lastStatusCheck: Date.now(),
};

export const createSyncSlice: ImmerStateCreator<SyncSlice> = (set) => ({
  sync: defaultSyncState,

  updateSyncStatus: (status) => {
    set((state) => {
      Object.assign(state.sync, status);
      state.sync.lastStatusCheck = Date.now();
    });
  },
});
