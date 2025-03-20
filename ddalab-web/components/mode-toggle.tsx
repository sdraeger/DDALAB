"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { updateUserPreferences } from "@/lib/auth";
import { useToast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { user, refreshUserData } = useAuth();
  const { toast } = useToast();

  // Only render the toggle after mounting to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Apply the user preference if available
  useEffect(() => {
    if (
      mounted &&
      user?.preferences?.theme &&
      theme !== user.preferences.theme
    ) {
      setTheme(user.preferences.theme);
    }
  }, [mounted, user, setTheme, theme]);

  // Update user preferences when changing theme
  const handleThemeChange = async (newTheme: string) => {
    // Skip if already on this theme
    if (theme === newTheme) return;

    // Get theme name for toast
    const themeName =
      newTheme === "dark"
        ? "Dark Mode"
        : newTheme === "light"
        ? "Light Mode"
        : "System Theme";

    // First, update the theme immediately for UI responsiveness
    setTheme(newTheme);

    // Then update user preferences if logged in
    if (user) {
      try {
        await updateUserPreferences({
          theme: newTheme as "light" | "dark" | "system",
        });
        refreshUserData();

        // Show toast notification
        toast({
          title: `Switched to ${themeName}`,
          description: "Your theme preference has been saved.",
          duration: 3000,
          variant: "default",
        });
      } catch (error) {
        console.error("Failed to update theme preference:", error);
        // Show error toast
        toast({
          title: "Failed to Save Theme",
          description: "Could not save your theme preference.",
          variant: "destructive",
          duration: 5000,
        });
      }
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
