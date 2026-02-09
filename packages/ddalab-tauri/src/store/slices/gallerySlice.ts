/**
 * Gallery Slice
 *
 * Manages state for the public results gallery — published items,
 * selected analyses for export, and gallery configuration.
 */

import type { GalleryConfig, PublishedGalleryItem } from "@/types/gallery";
import type { ImmerStateCreator } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface GalleryState {
  config: GalleryConfig;
  publishedItems: PublishedGalleryItem[];
  selectedAnalysisIds: string[];
  isExporting: boolean;
}

// ============================================================================
// Actions
// ============================================================================

export interface GalleryActions {
  setGalleryConfig: (config: Partial<GalleryConfig>) => void;
  setPublishedItems: (items: PublishedGalleryItem[]) => void;
  addPublishedItem: (item: PublishedGalleryItem) => void;
  removePublishedItem: (id: string) => void;
  toggleAnalysisForGallery: (analysisId: string) => void;
  setSelectedAnalysisIds: (ids: string[]) => void;
  clearGallerySelection: () => void;
  setGalleryExporting: (exporting: boolean) => void;
}

// ============================================================================
// Slice
// ============================================================================

export interface GallerySlice extends GalleryActions {
  gallery: GalleryState;
}

export const defaultGalleryState: GalleryState = {
  config: {
    outputDirectory: "",
    siteTitle: "DDA Results Gallery",
    siteDescription: "Delay Differential Analysis results",
    author: "",
    baseUrl: "/",
    theme: "light",
  },
  publishedItems: [],
  selectedAnalysisIds: [],
  isExporting: false,
};

export const createGallerySlice: ImmerStateCreator<GallerySlice> = (set) => ({
  gallery: defaultGalleryState,

  setGalleryConfig: (config) =>
    set((state) => {
      Object.assign(state.gallery.config, config);
    }),

  setPublishedItems: (items) =>
    set((state) => {
      state.gallery.publishedItems = items;
    }),

  addPublishedItem: (item) =>
    set((state) => {
      const idx = state.gallery.publishedItems.findIndex(
        (i) => i.id === item.id,
      );
      if (idx >= 0) {
        state.gallery.publishedItems[idx] = item;
      } else {
        state.gallery.publishedItems.push(item);
      }
    }),

  removePublishedItem: (id) =>
    set((state) => {
      state.gallery.publishedItems = state.gallery.publishedItems.filter(
        (i) => i.id !== id,
      );
    }),

  toggleAnalysisForGallery: (analysisId) =>
    set((state) => {
      const idx = state.gallery.selectedAnalysisIds.indexOf(analysisId);
      if (idx >= 0) {
        state.gallery.selectedAnalysisIds.splice(idx, 1);
      } else {
        state.gallery.selectedAnalysisIds.push(analysisId);
      }
    }),

  setSelectedAnalysisIds: (ids) =>
    set((state) => {
      state.gallery.selectedAnalysisIds = ids;
    }),

  clearGallerySelection: () =>
    set((state) => {
      state.gallery.selectedAnalysisIds = [];
    }),

  setGalleryExporting: (exporting) =>
    set((state) => {
      state.gallery.isExporting = exporting;
    }),
});
