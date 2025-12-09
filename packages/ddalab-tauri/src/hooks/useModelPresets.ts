/**
 * Hook for managing model encoding presets with localStorage persistence
 */

import { useState, useEffect, useCallback } from "react";

export interface ModelPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  encoding: number[];
  type: "structural" | "data-based"; // structural = based on term types, data-based = specific to data type
  dataType?: string; // e.g., 'EEG', 'ECG', etc.
  isCustom?: boolean; // user-created preset
  createdAt?: string;
}

const STORAGE_KEY = "ddalab_model_presets";

// Built-in structural presets (not persisted, always available)
const BUILTIN_STRUCTURAL_PRESETS: ModelPreset[] = [
  {
    id: "linear-only",
    name: "Linear Only",
    description: "All linear terms (degree 1)",
    icon: "📈",
    encoding: [], // Computed dynamically based on model space
    type: "structural",
  },
  {
    id: "quadratic-diagonal",
    name: "Quadratic Diagonal",
    description: "Linear + pure quadratic terms",
    icon: "📊",
    encoding: [],
    type: "structural",
  },
  {
    id: "full-quadratic",
    name: "Full Quadratic",
    description: "All terms up to degree 2",
    icon: "📉",
    encoding: [],
    type: "structural",
  },
  {
    id: "symmetric",
    name: "Symmetric",
    description: "Linear + pure higher order",
    icon: "⚖️",
    encoding: [],
    type: "structural",
  },
];

// Built-in data-based presets (not persisted, always available)
const BUILTIN_DATA_PRESETS: ModelPreset[] = [
  {
    id: "eeg-standard",
    name: "EEG Standard",
    description: "Standard model for EEG data analysis",
    icon: "🧠",
    encoding: [1, 2, 10], // Fixed encoding for EEG
    type: "data-based",
    dataType: "EEG",
  },
];

export const useModelPresets = () => {
  const [customPresets, setCustomPresets] = useState<ModelPreset[]>([]);

  // Load custom presets from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setCustomPresets(parsed);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save custom presets to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
    } catch {
      // Ignore localStorage errors
    }
  }, [customPresets]);

  // Get all presets (built-in + custom)
  const getAllPresets = useCallback((): ModelPreset[] => {
    return [
      ...BUILTIN_STRUCTURAL_PRESETS,
      ...BUILTIN_DATA_PRESETS,
      ...customPresets,
    ];
  }, [customPresets]);

  // Get structural presets only
  const getStructuralPresets = useCallback((): ModelPreset[] => {
    return [
      ...BUILTIN_STRUCTURAL_PRESETS,
      ...customPresets.filter((p) => p.type === "structural"),
    ];
  }, [customPresets]);

  // Get data-based presets only
  const getDataPresets = useCallback((): ModelPreset[] => {
    return [
      ...BUILTIN_DATA_PRESETS,
      ...customPresets.filter((p) => p.type === "data-based"),
    ];
  }, [customPresets]);

  // Add a new custom preset
  const addPreset = useCallback(
    (preset: Omit<ModelPreset, "id" | "isCustom" | "createdAt">) => {
      const newPreset: ModelPreset = {
        ...preset,
        id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        isCustom: true,
        createdAt: new Date().toISOString(),
      };

      setCustomPresets((prev) => [...prev, newPreset]);
      return newPreset;
    },
    [],
  );

  // Remove a custom preset
  const removePreset = useCallback((id: string) => {
    setCustomPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Update a custom preset
  const updatePreset = useCallback(
    (id: string, updates: Partial<ModelPreset>) => {
      setCustomPresets((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      );
    },
    [],
  );

  // Get a specific preset by ID
  const getPreset = useCallback(
    (id: string): ModelPreset | undefined => {
      return getAllPresets().find((p) => p.id === id);
    },
    [getAllPresets],
  );

  return {
    allPresets: getAllPresets(),
    structuralPresets: getStructuralPresets(),
    dataPresets: getDataPresets(),
    customPresets,
    addPreset,
    removePreset,
    updatePreset,
    getPreset,
  };
};
