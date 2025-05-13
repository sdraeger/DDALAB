"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { apiRequest } from "shared/lib/utils/request";
import { UserPreferences } from "../types/auth";

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "system",
  eegZoomFactor: 0.05,
};

type SettingsContextType = {
  userPreferences: UserPreferences | undefined;
  pendingChanges: Partial<UserPreferences>;
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

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterCredentials {
  username: string;
  password: string;
  email: string;
  firstName?: string;
  lastName?: string;
  inviteCode: string;
}

interface UserPreferencesResponse {
  theme: string;
  eegZoomFactor: number;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const { data: session } = useSession();
  const pathname = usePathname();

  // State for tracking changes
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(
    DEFAULT_USER_PREFERENCES
  );
  const [pendingChanges, setPendingChanges] = useState<
    Partial<UserPreferences>
  >({});
  const [unsavedChangesList, setUnsavedChangesList] = useState<string[]>([]);

  // Fetch preferences and force sync
  const fetchPreferences = useCallback(async () => {
    if (!session?.accessToken) return;

    try {
      const res: UserPreferencesResponse =
        await apiRequest<UserPreferencesResponse>({
          url: `/api/user-preferences`,
          method: "GET",
          token: session.accessToken,
          contentType: "application/json",
          responseType: "json",
        });

      const newPrefs: UserPreferences = {
        theme: res.theme as "light" | "dark" | "system",
        eegZoomFactor: res.eegZoomFactor,
      };

      console.log("Fetched preferences (SettingsProvider):", newPrefs);

      setUserPreferences(newPrefs);
      setPendingChanges({}); // Clear pending changes after fetch
    } catch (error) {
      console.error("Error fetching preferences:", error);
      setUserPreferences(DEFAULT_USER_PREFERENCES);
      setPendingChanges({});
    }
  }, [session?.accessToken]);

  useEffect(() => {
    if (session?.accessToken) fetchPreferences();
  }, [session?.accessToken, fetchPreferences]);

  const updatePreference = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      setPendingChanges((prev) => {
        const newChanges = { ...prev };
        if (userPreferences?.[key] === value) {
          delete newChanges[key];
        } else {
          newChanges[key] = value;
        }
        console.log("Updated pendingChanges:", newChanges);
        setUnsavedChangesList(Object.keys(newChanges));
        return newChanges;
      });
    },
    [userPreferences]
  );

  // Save all pending changes
  const saveChanges = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) {
      console.log("No pending changes to save");
      return true;
    }

    try {
      const payload = {
        theme: pendingChanges.theme,
        eeg_zoom_factor: pendingChanges.eegZoomFactor,
      };
      const res = await apiRequest({
        url: `/api/user-preferences`,
        method: "PUT",
        token: session?.accessToken,
        contentType: "application/json",
        body: payload,
        responseType: "json",
      });

      if (!res.ok) throw new Error(`Failed to save preferences: ${res.status}`);

      // Update local preferences immediately
      setUserPreferences((prev) => ({ ...prev, ...pendingChanges }));
      await fetchPreferences(); // Sync with backend
      setPendingChanges({});
      setUnsavedChangesList([]);
      return true;
    } catch (error) {
      console.error("Error saving preferences:", error);
      return false;
    }
  }, [pendingChanges, session?.accessToken, fetchPreferences]);

  // Reset changes to last saved state
  const resetChanges = useCallback(() => {
    setPendingChanges({});
    setUnsavedChangesList([]);
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

  const value = {
    userPreferences,
    pendingChanges,
    hasUnsavedChanges: unsavedChangesList.length > 0,
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
