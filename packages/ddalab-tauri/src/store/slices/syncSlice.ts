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
      // Use spread for partial updates - more idiomatic with Immer
      state.sync = { ...state.sync, ...status, lastStatusCheck: Date.now() };
    });
  },
});
