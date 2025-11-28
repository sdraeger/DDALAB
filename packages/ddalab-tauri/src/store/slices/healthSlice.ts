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
    if (typeof status === "function") {
      set((state) => {
        Object.assign(state.health, status(state.health));
      });
    } else {
      set((state) => {
        Object.assign(state.health, status);
      });
    }
  },
});
