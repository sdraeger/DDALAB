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
  const { data: session, update: updateSession } = useSession();
  const { toast } = useToast();
  const pathname = usePathname();

  // State for tracking changes
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);
  const [pendingChanges, setPendingChanges] = useState<
    Partial<UserPreferences>
  >({});
  const [unsavedChangesList, setUnsavedChangesList] = useState<string[]>([]);

  // Initialize preferences from session
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const res = await fetch("/api/user-preferences", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.accessToken}`,
          },
        });
        if (!res.ok) throw new Error("Failed to fetch preferences");
        const data = await res.json();
        setUserPreferences({ sessionExpiration: data.sessionExpiration });
      } catch (error) {
        console.error("Error fetching preferences:", error);
        setUserPreferences({ sessionExpiration: 30 * 60 }); // Default
      }
    };

    if (session) fetchPreferences();
  }, [session]);

  // Update a single preference
  const updatePreference = useCallback(
    (key: keyof UserPreferences, value: any) => {
      setPendingChanges((prev) => {
        const newChanges = { ...prev, [key]: value };
        setUnsavedChangesList(Object.keys(newChanges));
        return newChanges;
      });
    },
    []
  );

  // Save all pending changes
  const saveChanges = useCallback(async () => {
    try {
      const res = await fetch("/api/user-preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.accessToken}`,
        },
        body: JSON.stringify(pendingChanges),
      });

      if (!res.ok) throw new Error("Failed to save preferences");

      setUserPreferences((prev) => ({ ...prev, ...pendingChanges }));
      if (session) {
        await updateSession({
          ...session,
          user: {
            ...session.user,
            preferences: { ...session.user?.preferences, ...pendingChanges },
          },
        });
      }

      setPendingChanges({});
      setUnsavedChangesList([]);
      toast({
        title: "Settings Saved",
        description: "Preferences updated successfully.",
      });
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
  }, [pendingChanges, session, updateSession, toast]);

  // Reset changes to last saved state
  const resetChanges = useCallback(() => {
    if (session?.user?.preferences) {
      setPendingChanges(session.user.preferences);
    } else {
      setPendingChanges({});
    }
    setUnsavedChangesList([]);
  }, [session]);

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
    userPreferences: session?.user?.preferences || {},
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
