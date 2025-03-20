"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "./auth-context";
import { updateUserPreferences, type UserPreferences } from "@/lib/auth";
import { useToast } from "@/components/ui/use-toast";
import { usePathname } from "next/navigation";

type SettingsContextType = {
  userPreferences: UserPreferences;
  pendingChanges: UserPreferences;
  hasUnsavedChanges: boolean;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => void;
  saveChanges: () => Promise<boolean>;
  resetChanges: () => void;
  unsavedChangesList: string[];
};

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
);

interface SettingsProviderProps {
  children: ReactNode;
}

// Format preference values for display in the UI
const formatPreferenceLabel = (key: string, value: any): string => {
  switch (key) {
    case "theme":
      return `Theme: ${
        value === "light"
          ? "Light Mode"
          : value === "dark"
          ? "Dark Mode"
          : "System"
      }`;
    case "sessionExpiration":
      const minutes = Math.floor(value / 60);
      return `Session timeout: ${
        minutes >= 60
          ? `${Math.floor(minutes / 60)} hour${
              Math.floor(minutes / 60) > 1 ? "s" : ""
            }`
          : `${minutes} minute${minutes > 1 ? "s" : ""}`
      }`;
    case "eegZoomFactor":
      return `EEG zoom factor: ${(value * 100).toFixed(0)}%`;
    default:
      return `${key}: ${value}`;
  }
};

export function SettingsProvider({ children }: SettingsProviderProps) {
  const { user, refreshUserData } = useAuth();
  const { toast } = useToast();
  const pathname = usePathname();

  // State for tracking preferences
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({});
  const [pendingChanges, setPendingChanges] = useState<UserPreferences>({});
  const [unsavedChangesList, setUnsavedChangesList] = useState<string[]>([]);

  // Ref to prevent update loops
  const isUpdatingRef = useRef(false);

  // Initialize user preferences from auth context
  useEffect(() => {
    if (user?.preferences) {
      setUserPreferences(user.preferences);
    } else {
      setUserPreferences({});
    }

    // Reset pending changes when user changes
    setPendingChanges({});
    setUnsavedChangesList([]);
  }, [user]);

  // Simple utility to check if two values are different
  // Works for primitives, and uses a small epsilon for numbers
  const isDifferent = useCallback((a: any, b: any): boolean => {
    // Handle undefined/null cases
    if (a === undefined || b === undefined) return a !== b;
    if (a === null || b === null) return a !== b;

    // For numbers, use epsilon comparison
    if (typeof a === "number" && typeof b === "number") {
      return Math.abs(a - b) > 0.0001;
    }

    // For other types, use string comparison
    return JSON.stringify(a) !== JSON.stringify(b);
  }, []);

  // Get a list of all changes between pending and user preferences
  const getChanges = useCallback(
    (
      pending: UserPreferences,
      original: UserPreferences
    ): Record<string, any> => {
      const changes: Record<string, any> = {};

      // Check each key in pending changes
      Object.keys(pending).forEach((key) => {
        const typedKey = key as keyof UserPreferences;
        const pendingValue = pending[typedKey];
        const originalValue = original[typedKey];

        // Only add to result if the value has changed
        if (isDifferent(pendingValue, originalValue)) {
          changes[key] = pendingValue;
        }
      });

      return changes;
    },
    [isDifferent]
  );

  // Update unsaved changes list when pendingChanges or userPreferences change
  useEffect(() => {
    if (isUpdatingRef.current) {
      console.log("Skipping update while isUpdating is true");
      return;
    }

    // Get all changed preferences
    const changedPrefs = getChanges(pendingChanges, userPreferences);
    const changedKeys = Object.keys(changedPrefs);

    // Format the changed values for display
    const newChangesList = changedKeys.map((key) =>
      formatPreferenceLabel(key, changedPrefs[key])
    );

    // Update the UI (only if the list has actually changed)
    const currentList = JSON.stringify(unsavedChangesList);
    const newList = JSON.stringify(newChangesList);

    if (currentList !== newList) {
      console.log("Updating unsaved changes list:", {
        from: unsavedChangesList,
        to: newChangesList,
        pendingChanges,
        userPreferences,
        changedPrefs,
      });
      setUnsavedChangesList(newChangesList);
    }
  }, [pendingChanges, userPreferences, getChanges, unsavedChangesList]);

  // Calculate if there are unsaved changes directly from pendingChanges
  const calculateHasChanges = useCallback(() => {
    // Directly check if there are any pending changes
    if (Object.keys(pendingChanges).length === 0) return false;

    // Check if any pending change is different from user preferences
    const changedPrefs = getChanges(pendingChanges, userPreferences);
    return Object.keys(changedPrefs).length > 0;
  }, [pendingChanges, userPreferences, getChanges]);

  // Calculate hasUnsavedChanges directly from pending changes
  const hasUnsavedChanges = calculateHasChanges();

  // Log whenever hasUnsavedChanges changes
  useEffect(() => {
    console.log(
      "HasUnsavedChanges updated:",
      hasUnsavedChanges,
      "pendingChanges:",
      pendingChanges,
      "changedKeys:",
      Object.keys(getChanges(pendingChanges, userPreferences))
    );
  }, [hasUnsavedChanges, pendingChanges, userPreferences, getChanges]);

  // Update a single preference
  const updatePreference = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      // Prevent update loops
      if (isUpdatingRef.current) {
        console.log("Skipping updatePreference call while updating");
        return;
      }

      // Skip update if value hasn't changed from current value
      const currentPendingValue = pendingChanges[key];
      if (!isDifferent(value, currentPendingValue)) {
        console.log(`Value ${key} unchanged, skipping update`);
        return;
      }

      console.log(`Updating preference ${String(key)} to`, value);
      isUpdatingRef.current = true;

      try {
        // Update the pending changes
        setPendingChanges((prev) => ({
          ...prev,
          [key]: value,
        }));
      } finally {
        // Always ensure we reset the updating flag
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      }
    },
    [pendingChanges, isDifferent]
  );

  // Save all changes
  const saveChanges = useCallback(async (): Promise<boolean> => {
    if (isUpdatingRef.current) return false;
    isUpdatingRef.current = true;

    try {
      // Calculate which preferences have actually changed
      const changedPrefs = getChanges(pendingChanges, userPreferences);

      // Skip if nothing has changed
      if (Object.keys(changedPrefs).length === 0) {
        setPendingChanges({});
        setUnsavedChangesList([]);
        return true;
      }

      // Save the changes
      const success = await updateUserPreferences(
        changedPrefs as UserPreferences
      );

      if (success) {
        // Refresh user data to get updated preferences
        refreshUserData();

        // Clear pending changes
        setPendingChanges({});
        setUnsavedChangesList([]);

        // Notify the user
        toast({
          title: "Settings saved",
          description: "Your preferences have been updated successfully.",
        });

        return true;
      } else {
        throw new Error("Failed to update preferences");
      }
    } catch (error) {
      console.error("Error saving preferences:", error);
      toast({
        title: "Save failed",
        description: "Could not save your preferences. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      // Always ensure we reset the updating flag
      isUpdatingRef.current = false;
    }
  }, [pendingChanges, userPreferences, getChanges, refreshUserData, toast]);

  // Reset all pending changes
  const resetChanges = useCallback(() => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;

    try {
      setPendingChanges({});
      setUnsavedChangesList([]);
    } finally {
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, []);

  // Alert when navigating away with unsaved changes
  useEffect(() => {
    if (!pathname?.includes("/dashboard/settings")) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsavedChangesList.length > 0) {
        e.preventDefault();
        e.returnValue =
          "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [unsavedChangesList, pathname]);

  // Context value
  const value = {
    userPreferences,
    pendingChanges,
    hasUnsavedChanges,
    updatePreference,
    saveChanges,
    resetChanges,
    unsavedChangesList,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
