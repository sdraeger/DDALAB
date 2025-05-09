"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import { useSettings } from "../contexts/settings-context";
import { useSession } from "next-auth/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";

type ThemeOption = "light" | "dark" | "system";

export function ThemeSettings() {
  // Generate a stable component ID
  const componentId = useRef(
    `theme-settings-${Math.random().toString(36).substring(2, 9)}`
  );

  const { theme, setTheme } = useTheme();
  const { updatePreference, userPreferences, pendingChanges } = useSettings();
  const { data: session } = useSession();

  // Local UI state
  const [localTheme, setLocalTheme] = useState<ThemeOption>("system");

  // Track update state with refs
  const isUpdatingRef = useRef(false);
  const wasInitializedRef = useRef(false);

  // Initialize once
  useEffect(() => {
    if (wasInitializedRef.current) return;

    // Determine initial theme from preferences or system
    const initialTheme =
      (session?.user?.preferences?.theme as ThemeOption) ||
      (theme as ThemeOption) ||
      "system";

    // Update local state
    setLocalTheme(initialTheme);

    // Set the actual theme if needed
    if (theme !== initialTheme) {
      setTheme(initialTheme);
    }

    wasInitializedRef.current = true;
  }, [session, theme, setTheme]);

  // Listen for context changes
  useEffect(() => {
    if (isUpdatingRef.current) return;

    // Get theme from pending changes or fall back to user preferences
    const pendingTheme = pendingChanges.theme as ThemeOption | undefined;
    const prefsTheme = userPreferences?.theme as ThemeOption | undefined;

    const contextTheme = pendingTheme || prefsTheme;

    // Only update if theme exists and differs from current local theme
    if (contextTheme && contextTheme !== localTheme) {
      console.log(
        `[${componentId.current}] Context theme changed to ${contextTheme}`
      );

      // Update local UI
      setLocalTheme(contextTheme);

      // Apply theme change
      setTheme(contextTheme);
    }
  }, [pendingChanges.theme, userPreferences?.theme, localTheme, setTheme]);

  // Handle theme selection in UI
  const handleThemeChange = useCallback(
    (value: ThemeOption) => {
      // Skip if already updating or no change
      if (isUpdatingRef.current) return;
      if (value === localTheme) return;

      console.log(`[${componentId.current}] User selected theme: ${value}`);

      // Update local UI immediately for responsiveness
      setLocalTheme(value);

      // Apply theme change for immediate visual feedback
      setTheme(value);

      // Prevent further updates while we're updating
      isUpdatingRef.current = true;

      // Schedule context update
      setTimeout(() => {
        updatePreference("theme", value);

        // Reset update flag after a delay
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 50);
      }, 0);
    },
    [localTheme, setTheme, updatePreference]
  );

  // Handle reset button click
  const handleReset = useCallback(() => {
    if (isUpdatingRef.current) return;
    if (localTheme === "system") return;

    handleThemeChange("system");
  }, [localTheme, handleThemeChange]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme Settings</CardTitle>
        <CardDescription>
          Choose your preferred theme or use your system settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Select value={localTheme} onValueChange={handleThemeChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">
                <div className="flex items-center">
                  <Sun className="mr-2 h-4 w-4" />
                  Light Mode
                </div>
              </SelectItem>
              <SelectItem value="dark">
                <div className="flex items-center">
                  <Moon className="mr-2 h-4 w-4" />
                  Dark Mode
                </div>
              </SelectItem>
              <SelectItem value="system">
                <div className="flex items-center">
                  <MonitorSmartphone className="mr-2 h-4 w-4" />
                  System Preference (Default)
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          <div className="text-sm text-muted-foreground mt-2">
            {localTheme === "system" ? (
              <span>
                Theme will automatically change based on your system settings
              </span>
            ) : (
              <span>Theme will remain fixed regardless of system settings</span>
            )}
          </div>
        </div>

        {localTheme !== "system" && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleReset} size="sm">
              Reset to Default
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
