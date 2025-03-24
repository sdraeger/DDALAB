"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/ui/use-toast";
import { useSettings } from "@/contexts/settings-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();
  const { toast } = useToast();
  const { updatePreference, saveChanges, pendingChanges, hasUnsavedChanges } =
    useSettings();

  // Only render the toggle after mounting to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Apply the user preference if available
  useEffect(() => {
    if (
      mounted &&
      session?.user?.preferences?.theme &&
      theme !== session.user.preferences.theme
    ) {
      setTheme(session.user.preferences.theme);
    }
  }, [mounted, session, setTheme, theme]);

  const handleThemeChange = async (newTheme: "light" | "dark" | "system") => {
    if (theme === newTheme) return;

    setTheme(newTheme);

    try {
      updatePreference("theme", newTheme);
      const success = await saveChanges(); // Persists changes to backend
      if (success) {
        toast({
          title: `Switched to ${newTheme} theme`,
          description: "Your theme preference has been saved.",
          duration: 3000,
          variant: "default",
        });
      }
    } catch (error) {
      console.error("Failed to update theme preference:", error);
      toast({
        title: "Failed to Save Theme",
        description: "Could not save your theme preference.",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <Sun className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    );
  }

  // Show different icon based on current theme
  const ThemeIcon =
    theme === "dark" ? Sun : theme === "light" ? Moon : MonitorSmartphone;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Select theme">
          <ThemeIcon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleThemeChange("light")}>
          <Sun className="mr-2 h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleThemeChange("system")}>
          <MonitorSmartphone className="mr-2 h-4 w-4" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
