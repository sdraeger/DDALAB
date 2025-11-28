/**
 * ICA (Independent Component Analysis) state slice
 */

import type { ImmerStateCreator, ICASlice, ICAState } from "./types";

export const defaultICAState: ICAState = {
  selectedChannels: [],
  nComponents: undefined,
  maxIterations: 200,
  tolerance: 0.0001,
  centering: true,
  whitening: true,
  showChannelSelector: false,
  selectedResultId: null,
  isSubmitting: false,
};

export const createICASlice: ImmerStateCreator<ICASlice> = (set) => ({
  ica: defaultICAState,

  updateICAState: (updates) => {
    set((state) => {
      Object.assign(state.ica, updates);
    });
  },

  resetICAChannels: (channels) => {
    set((state) => {
      state.ica.selectedChannels = channels;
    });
  },
});
