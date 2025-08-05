"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useToast } from "../ui/use-toast";
import { useSettings } from "../../contexts/SettingsContext";
import { useAuthMode } from "../../contexts/AuthModeContext";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";

type Theme = "light" | "dark" | "system";

export function ThemeInitializer() {
  const { theme, setTheme } = useTheme();
  const { isMultiUserMode } = useAuthMode();
  const { data: session } = useUnifiedSessionData();
  const { toast } = useToast();
  const { userPreferences, updatePreference, saveChanges } = useSettings();
  const isInitialMount = useRef(true);
  const [isInitialized, setIsInitialized] = useState(false);

  // Stable refs to prevent dependency loops
  const sessionThemeRef = useRef<string | null>(null);
  const userPreferencesThemeRef = useRef<string | null>(null);

  // Initialize theme from session (only in multi-user mode, only once)
  useEffect(() => {
    if (isInitialMount.current && isMultiUserMode && session?.user?.preferences?.theme) {
      const sessionTheme = session.user.preferences.theme as Theme;
      if (theme !== sessionTheme) {
        console.log("[ThemeInitializer] Setting theme from session:", sessionTheme);
        setTheme(sessionTheme);
      }
    }
    if (isInitialMount.current) {
      isInitialMount.current = false;
      setIsInitialized(true);
    }
  }, [isMultiUserMode, session?.user?.preferences?.theme, theme, setTheme]);

  // Sync theme changes to user preferences (after initialization, with debouncing)
  useEffect(() => {
    if (!isInitialized || !theme) return;

    // Use refs to track previous values and prevent unnecessary updates
    if (sessionThemeRef.current === theme && userPreferencesThemeRef.current === theme) {
      return;
    }

    // Only update if theme actually changed from user preferences
    if (theme !== userPreferences.theme) {
      console.log("[ThemeInitializer] Syncing theme to preferences:", theme);

      const timeoutId = setTimeout(() => {
        updatePreference("theme", theme as Theme);
        saveChanges().catch(() => {
          console.error("Failed to save theme preference");
        });
      }, 200); // Debounce to prevent rapid updates

      return () => clearTimeout(timeoutId);
    }
  }, [theme, userPreferences.theme, updatePreference, saveChanges, isInitialized]);

  // Update refs when values change
  useEffect(() => {
    sessionThemeRef.current = session?.user?.preferences?.theme || null;
  }, [session?.user?.preferences?.theme]);

  useEffect(() => {
    userPreferencesThemeRef.current = userPreferences.theme;
  }, [userPreferences.theme]);

  return null;
}
