/**
 * Health monitoring slice
 */

import type { ImmerStateCreator, HealthSlice, HealthState } from "./types";

export const defaultHealthState: HealthState = {
  apiStatus: "checking",
  lastCheck: Date.now(),
  responseTime: 0,
  websocketConnected: false,
  errors: [],
};

export const createHealthSlice: ImmerStateCreator<HealthSlice> = (set) => ({
  health: defaultHealthState,

  updateHealthStatus: (status) => {
    set((state) => {
      // Use spread for partial updates - more idiomatic with Immer
      const updates =
        typeof status === "function" ? status(state.health) : status;
      state.health = { ...state.health, ...updates };
    });
  },
});
