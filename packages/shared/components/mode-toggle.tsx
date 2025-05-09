"use client";

import { useTheme } from "next-themes";
import { Button } from "./ui/button";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "./ui/use-toast";
import { useSettings } from "../contexts/settings-context";
import { DEFAULT_USER_PREFERENCES } from "../contexts/settings-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();
  const { toast } = useToast();
  const { updatePreference, saveChanges, userPreferences, pendingChanges } =
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
  }, [mounted, session?.user?.preferences?.theme, setTheme]);

  const handleThemeChange = async (newTheme: "light" | "dark" | "system") => {
    if (theme === newTheme) return;

    console.log("Theme changing to:", newTheme);
    setTheme(newTheme);

    console.log("Before updatePreference, pendingChanges:", pendingChanges);
    updatePreference("theme", newTheme);
    console.log("After updatePreference, pendingChanges:", pendingChanges);

    saveChanges()
      .then((success) => {
        console.log("saveChanges result:", success);
        if (success) {
          console.log(
            "Theme save successful, new preferences:",
            userPreferences
          );
          toast({
            title: `Switched to ${newTheme} theme`,
            description: "Your theme preference has been saved.",
            duration: 3000,
            variant: "default",
          });
        } else {
          throw new Error("Save reported success but failed");
        }
      })
      .catch((error) => {
        console.error("Failed to update theme preference:", error);
        toast({
          title: "Failed to Save Theme",
          description: "Could not save your theme preference.",
          variant: "destructive",
          duration: 5000,
        });
        setTheme(theme || "system");
      });
  };

  const handleZoomFactorChange = (value: number) => {
    updatePreference("eegZoomFactor", value);
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
    theme === "dark" ? Moon : theme === "light" ? Sun : MonitorSmartphone;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Select theme">
          <ThemeIcon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handleThemeChange("light")}>
          <Sun className="mr-2 h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleThemeChange("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleThemeChange("system")}>
          <MonitorSmartphone className="mr-2 h-4 w-4" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
