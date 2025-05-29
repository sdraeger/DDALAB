"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { useToast } from "../ui/use-toast";

export function ThemeInitializer() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const { toast } = useToast();

  useEffect(() => {
    if (
      session?.user?.preferences?.theme &&
      theme !== session.user.preferences.theme
    ) {
      const newTheme = session.user.preferences.theme;
      setTheme(newTheme);

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

  return null;
}
