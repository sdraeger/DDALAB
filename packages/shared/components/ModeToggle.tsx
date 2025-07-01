"use client";

import { useEffect, useState } from "react";
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
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch by tracking mounted state
  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Prevent hydration mismatch by not rendering theme-dependent content until mounted
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Select theme">
        <MonitorSmartphone className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    );
  }

  const ThemeIcon = getThemeIcon(theme);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Select theme">
          <ThemeIcon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        avoidCollisions={false}
        className="z-[9999] min-w-[140px] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const target = e.target as Element;
          if (target && target.closest('[data-radix-dropdown-menu-trigger]')) {
            e.preventDefault();
          }
        }}
        style={{
          position: 'fixed',
          willChange: 'transform',
          top: 'var(--radix-popper-anchor-height, 0px)',
          left: 'var(--radix-popper-anchor-width, 0px)',
          transformOrigin: 'top right',
        }}
      >
        <DropdownMenuItem
          onSelect={() => handleThemeChange("light")}
          className="cursor-pointer"
        >
          <Sun className="mr-2 h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => handleThemeChange("dark")}
          className="cursor-pointer"
        >
          <Moon className="mr-2 h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => handleThemeChange("system")}
          className="cursor-pointer"
        >
          <MonitorSmartphone className="mr-2 h-4 w-4" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
