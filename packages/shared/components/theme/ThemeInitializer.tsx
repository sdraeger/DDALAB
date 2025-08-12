"use client";

import { useEffect } from "react";
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

  // Initialize theme from session (only in multi-user mode, once on mount)
  useEffect(() => {
    if (isMultiUserMode && session?.user?.preferences?.theme) {
      const sessionTheme = session.user.preferences.theme as Theme;
      if (theme !== sessionTheme) {
        console.log("[ThemeInitializer] Setting theme from session:", sessionTheme);
        setTheme(sessionTheme);
      }
    }
  }, [isMultiUserMode, session?.user?.preferences?.theme, theme, setTheme]);

  // Sync theme changes to user preferences (debounced)
  useEffect(() => {
    if (!theme) return;

    if (theme !== userPreferences.theme) {
      console.log("[ThemeInitializer] Syncing theme to preferences:", theme);

      const timeoutId = setTimeout(() => {
        updatePreference("theme", theme as Theme);
        saveChanges().catch(() => {
          console.error("Failed to save theme preference");
        });
      }, 200);

      return () => clearTimeout(timeoutId);
    }
  }, [theme, userPreferences.theme, updatePreference, saveChanges]);

  return null;
}
