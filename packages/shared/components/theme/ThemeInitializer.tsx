"use client";

import { useEffect, useRef } from "react";
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

  useEffect(() => {
    // On initial mount, sync from session preferences (only in multi-user mode)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (isMultiUserMode && session?.user?.preferences?.theme && theme !== session.user.preferences.theme) {
        const newTheme = session.user.preferences.theme as Theme;
        setTheme(newTheme);
        return;
      }
    }

    // After initial mount, only sync theme changes to settings
    if (!isInitialMount.current && theme && theme !== userPreferences.theme) {
      updatePreference("theme", theme as Theme);
      saveChanges().catch(() => {
        console.error("Failed to save theme preference");
      });
    }
  }, [session, theme, userPreferences.theme, setTheme, updatePreference, saveChanges, isMultiUserMode]);

  return null;
}
