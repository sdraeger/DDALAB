"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { useToast } from "../ui/use-toast";

/**
 * This component synchronizes the theme with user preferences.
 * It doesn't render anything, it just initializes the theme.
 */
export function ThemeInitializer() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const { toast } = useToast();

  // Apply user's theme preference when user data is available
  useEffect(() => {
    if (
      session?.user?.preferences?.theme &&
      theme !== session.user.preferences.theme
    ) {
      const newTheme = session.user.preferences.theme;
      setTheme(newTheme);

      // Toast notification when theme is applied from settings
      const themeName =
        newTheme === "dark"
          ? "Dark Mode"
          : newTheme === "light"
          ? "Light Mode"
          : "System Theme";

      toast({
        title: `Applied Theme: ${themeName}`,
        description: "Your saved theme preference has been applied.",
        duration: 3000,
      });
    }
  }, [session, theme, setTheme, toast]);

  // This component doesn't render anything
  return null;
}
