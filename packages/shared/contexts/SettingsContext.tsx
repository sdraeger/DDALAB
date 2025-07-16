"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { apiRequest } from "../lib/utils/request";
import { UserPreferences } from "../types/auth";
import { useAuthMode } from "./AuthModeContext";
import { useUnifiedSessionData } from "../hooks/useUnifiedSession";

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "system",
  eegZoomFactor: 0.05,
};

type SettingsContextType = {
  userPreferences: UserPreferences;
  pendingChanges: Partial<UserPreferences>;
  hasUnsavedChanges: boolean;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => void;
  saveChanges: () => Promise<boolean>;
  resetChanges: () => void;
  loadPreferences: () => Promise<void>;
};

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
);

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const { isMultiUserMode } = useAuthMode();

  // Use unified session data that works in both modes
  const { data: sessionData, status } = useUnifiedSessionData();
  const session = isMultiUserMode ? sessionData : null;

  const [userPreferences, setUserPreferences] = useState<UserPreferences>(
    DEFAULT_USER_PREFERENCES
  );
  const [pendingChanges, setPendingChanges] = useState<
    Partial<UserPreferences>
  >({});

  const loadPreferences = async () => {
    // Only load from API in multi-user mode with valid session
    if (!isMultiUserMode || !session?.accessToken) {
      // In local mode, try to load from localStorage
      if (!isMultiUserMode) {
        try {
          const saved = localStorage.getItem('dda-local-preferences');
          if (saved) {
            const preferences = JSON.parse(saved);
            setUserPreferences({ ...DEFAULT_USER_PREFERENCES, ...preferences });
          }
        } catch (error) {
          console.warn('Failed to load local preferences:', error);
        }
      }
      return;
    }

    try {
      const res = await apiRequest<UserPreferences>({
        url: `/api/user-preferences`,
        method: "GET",
        token: session.accessToken,
        contentType: "application/json",
        responseType: "json",
      });
      setUserPreferences(res);
      setPendingChanges({});
    } catch {
      setUserPreferences(DEFAULT_USER_PREFERENCES);
      setPendingChanges({});
    }
  };

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    if (userPreferences[key] === value) {
      setPendingChanges((prev) => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
    } else {
      setPendingChanges((prev) => ({ ...prev, [key]: value }));
    }
  };

  const saveChanges = async () => {
    if (!Object.keys(pendingChanges).length) return true;

    // In local mode, just apply changes locally and save to localStorage
    if (!isMultiUserMode) {
      const newPreferences = { ...userPreferences, ...pendingChanges };
      setUserPreferences(newPreferences);
      setPendingChanges({});

      try {
        localStorage.setItem('dda-local-preferences', JSON.stringify(newPreferences));
      } catch (error) {
        console.warn('Failed to save local preferences:', error);
      }

      return true;
    }

    // In multi-user mode, save to API
    if (!session?.accessToken) return false;

    try {
      await apiRequest({
        url: `/api/user-preferences`,
        method: "PUT",
        token: session.accessToken,
        contentType: "application/json",
        body: {
          theme: pendingChanges.theme,
          eeg_zoom_factor: pendingChanges.eegZoomFactor,
        },
        responseType: "json",
      });
      setUserPreferences((prev) => ({ ...prev, ...pendingChanges }));
      setPendingChanges({});
      return true;
    } catch {
      return false;
    }
  };

  const resetChanges = () => setPendingChanges({});

  const value: SettingsContextType = {
    userPreferences,
    pendingChanges,
    hasUnsavedChanges: !!Object.keys(pendingChanges).length,
    updatePreference,
    saveChanges,
    resetChanges,
    loadPreferences,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
