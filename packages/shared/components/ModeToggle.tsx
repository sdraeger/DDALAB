"use client";

import { useTheme } from "next-themes";
import { useToast } from "./ui/use-toast";
import { useSettings } from "../contexts/SettingsContext";
import { Button } from "./ui/button";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type Theme = "light" | "dark" | "system";

const getThemeIcon = (theme: string | undefined) => {
  switch (theme) {
    case "dark":
      return Moon;
    case "light":
      return Sun;
    default:
      return MonitorSmartphone;
  }
};

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const { updatePreference, saveChanges } = useSettings();

  const handleThemeChange = async (newTheme: Theme) => {
    if (newTheme === theme) return;

    setTheme(newTheme);
    updatePreference("theme", newTheme);

    try {
      const saved = await saveChanges();
      if (!saved) throw new Error("Save failed");
      toast({
        title: `Switched to ${newTheme} theme`,
        description: "Your theme preference has been saved.",
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: "Failed to Save Theme",
        description: "Could not save your theme preference.",
        variant: "destructive",
        duration: 5000,
      });
      setTheme(theme || "system");
    }
  };

  const ThemeIcon = getThemeIcon(theme);

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
