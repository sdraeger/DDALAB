"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { useToast } from "../ui/use-toast";
import { useSettings } from "../../contexts/SettingsContext";

type Theme = "light" | "dark" | "system";

export function ThemeInitializer() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { userPreferences, updatePreference, saveChanges } = useSettings();
  const isInitialMount = useRef(true);

  useEffect(() => {
    // On initial mount, sync from session preferences
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (session?.user?.preferences?.theme && theme !== session.user.preferences.theme) {
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
  }, [session, theme, userPreferences.theme, setTheme, updatePreference, saveChanges]);

  return null;
}
