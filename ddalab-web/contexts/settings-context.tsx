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

export interface User {
  id: string;
  username: string;
  name: string;
  email?: string;
  role?: string;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  sessionExpiration?: number; // in seconds
  eegZoomFactor?: number; // Zoom factor for EEG chart (between 0.01 and 0.2)
  theme?: "light" | "dark" | "system"; // Theme preference
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user?: User;
  expiresIn?: number;
}

export interface RegisterCredentials {
  username: string;
  password: string;
  email: string;
  firstName?: string;
  lastName?: string;
  inviteCode: string;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const { data: session, update: updateSession } = useSession();
  const { toast } = useToast();
  const pathname = usePathname();

  // State for tracking changes
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({
    sessionExpiration: 30 * 60, // Default values
    theme: "system",
    eegZoomFactor: 0.05,
  });
  const [pendingChanges, setPendingChanges] = useState<
    Partial<UserPreferences>
  >({});
  const [unsavedChangesList, setUnsavedChangesList] = useState<string[]>([]);

  // Fetch preferences and force sync
  const fetchPreferences = useCallback(async () => {
    if (!session?.accessToken) return;

    try {
      const res = await fetch("/api/user-preferences", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          "Cache-Control": "no-cache",
        },
      });

      if (!res.ok)
        throw new Error(`Failed to fetch preferences: ${res.status}`);
      const data = await res.json();
      const newPrefs = {
        sessionExpiration: data.session_expiration ?? 30 * 60,
        theme: data.theme ?? "system",
        eegZoomFactor: data.eeg_zoom_factor ?? 0.05,
      };

      console.log("Fetched preferences (SettingsProvider):", newPrefs);

      setUserPreferences(newPrefs);
      setPendingChanges({}); // Clear pending changes after fetch
    } catch (error) {
      console.error("Error fetching preferences:", error);
      setUserPreferences({
        sessionExpiration: 30 * 60,
        theme: "system",
        eegZoomFactor: 0.05,
      });
      setPendingChanges({});
    }
  }, [session?.accessToken]);

  useEffect(() => {
    if (session?.accessToken) fetchPreferences();
  }, [session?.accessToken, fetchPreferences]);

  // Update a single preference
  const updatePreference = useCallback(
    (key: keyof UserPreferences, value: any) => {
      setPendingChanges((prev) => {
        if (userPreferences[key] === value) {
          const { [key]: _, ...rest } = prev;
          setUnsavedChangesList(Object.keys(rest));
          return rest;
        }
        const newChanges = { ...prev, [key]: value };
        setUnsavedChangesList(Object.keys(newChanges));
        return newChanges;
      });
    },
    [userPreferences]
  );

  // Save all pending changes
  const saveChanges = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) return true;

    try {
      const res = await fetch("/api/user-preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.accessToken}`,
        },
        body: JSON.stringify(pendingChanges),
      });

      if (!res.ok) throw new Error(`Failed to save preferences: ${res.status}`);

      // Refetch and sync
      await fetchPreferences(); // Reuse fetch function

      if (session) {
        const updatedPrefs = { ...userPreferences, ...pendingChanges };
        await updateSession({
          ...session,
          user: {
            ...session.user,
            preferences: updatedPrefs,
          },
        });
      }

      setPendingChanges({});
      setUnsavedChangesList([]);
      //   toast({
      //     title: "Settings Saved",
      //     description: "Preferences updated successfully.",
      //   });

      return true;
    } catch (error) {
      console.error("Error saving preferences:", error);
      toast({
        title: "Save Failed",
        description: "Could not save preferences.",
        variant: "destructive",
      });
      return false;
    }
  }, [pendingChanges, session, updateSession, toast, fetchPreferences]);

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
