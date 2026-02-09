/**
 * Plugin Slice
 *
 * Manages state for the WASM plugin system — installed plugins,
 * registry browsing, and installation progress.
 */

import type { ImmerStateCreator } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  license: string | null;
  category: string;
  permissions: string[];
  wasmHash: string;
  source: string;
  sourceUrl: string | null;
  installedAt: string;
  enabled: boolean;
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  permissions: string[];
  artifactUrl: string;
  sha256: string;
  minDdalabVersion: string | null;
  publishedAt: string;
}

export interface PluginState {
  installedPlugins: InstalledPlugin[];
  registryEntries: RegistryEntry[];
  registryLoading: boolean;
  selectedPluginId: string | null;
  installInProgress: string[];
}

// ============================================================================
// Actions
// ============================================================================

export interface PluginActions {
  setInstalledPlugins: (plugins: InstalledPlugin[]) => void;
  addInstalledPlugin: (plugin: InstalledPlugin) => void;
  removeInstalledPlugin: (id: string) => void;
  togglePluginEnabled: (id: string, enabled: boolean) => void;
  setRegistryEntries: (entries: RegistryEntry[]) => void;
  setRegistryLoading: (loading: boolean) => void;
  setSelectedPlugin: (id: string | null) => void;
  setInstallInProgress: (id: string, inProgress: boolean) => void;
}

// ============================================================================
// Slice
// ============================================================================

export interface PluginSlice extends PluginActions {
  plugins: PluginState;
}

export const defaultPluginState: PluginState = {
  installedPlugins: [],
  registryEntries: [],
  registryLoading: false,
  selectedPluginId: null,
  installInProgress: [],
};

export const createPluginSlice: ImmerStateCreator<PluginSlice> = (set) => ({
  plugins: defaultPluginState,

  setInstalledPlugins: (plugins) =>
    set((state) => {
      state.plugins.installedPlugins = plugins;
    }),

  addInstalledPlugin: (plugin) =>
    set((state) => {
      const idx = state.plugins.installedPlugins.findIndex(
        (p) => p.id === plugin.id,
      );
      if (idx >= 0) {
        state.plugins.installedPlugins[idx] = plugin;
      } else {
        state.plugins.installedPlugins.push(plugin);
      }
    }),

  removeInstalledPlugin: (id) =>
    set((state) => {
      state.plugins.installedPlugins = state.plugins.installedPlugins.filter(
        (p) => p.id !== id,
      );
      if (state.plugins.selectedPluginId === id) {
        state.plugins.selectedPluginId = null;
      }
    }),

  togglePluginEnabled: (id, enabled) =>
    set((state) => {
      const plugin = state.plugins.installedPlugins.find((p) => p.id === id);
      if (plugin) {
        plugin.enabled = enabled;
      }
    }),

  setRegistryEntries: (entries) =>
    set((state) => {
      state.plugins.registryEntries = entries;
    }),

  setRegistryLoading: (loading) =>
    set((state) => {
      state.plugins.registryLoading = loading;
    }),

  setSelectedPlugin: (id) =>
    set((state) => {
      state.plugins.selectedPluginId = id;
    }),

  setInstallInProgress: (id, inProgress) =>
    set((state) => {
      if (inProgress) {
        if (!state.plugins.installInProgress.includes(id)) {
          state.plugins.installInProgress.push(id);
        }
      } else {
        state.plugins.installInProgress =
          state.plugins.installInProgress.filter((pid) => pid !== id);
      }
    }),
});
