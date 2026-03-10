"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Compass,
  FlaskConical,
  Monitor,
  Moon,
  Palette,
  Sun,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { requestOnboardingReplay } from "@/lib/appNavigationEvents";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function GeneralSettings() {
  const expertMode = useAppStore((state) => state.ui.expertMode);
  const setExpertMode = useAppStore((state) => state.setExpertMode);
  const storeSetTheme = useAppStore((state) => state.setTheme);
  const { theme, resolvedTheme, setTheme: setNextTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleThemeChange = (value: string) => {
    setNextTheme(value);
    storeSetTheme(value === "system" ? "auto" : (value as "light" | "dark"));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">General Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure general application preferences
        </p>
      </div>

      {/* Appearance */}
      <Card className="transition-shadow duration-150 hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Palette className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            Appearance
          </CardTitle>
          <CardDescription>
            Choose how DDALAB looks on your device
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mounted && (
            <div className="grid grid-cols-3 gap-3">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                const isSelected = theme === value;
                return (
                  <button
                    key={value}
                    onClick={() => handleThemeChange(value)}
                    className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover:bg-accent"
                    }`}
                  >
                    <Icon
                      className={`h-6 w-6 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <span
                      className={`text-sm font-medium ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {mounted && theme === "system" && resolvedTheme && (
            <p className="text-xs text-muted-foreground">
              Currently using {resolvedTheme} mode based on your system
              preference
            </p>
          )}
        </CardContent>
      </Card>

      {/* Expert Mode */}
      <Card className="transition-shadow duration-150 hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <FlaskConical className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            Expert Mode
          </CardTitle>
          <CardDescription>
            Control visibility of advanced configuration options
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="expert-mode" className="text-base">
                Enable Expert Mode
              </Label>
              <p className="text-sm text-muted-foreground">
                Show advanced DDA configuration options like custom delay
                parameters and model encoding selection
              </p>
            </div>
            <Switch
              id="expert-mode"
              checked={expertMode}
              onCheckedChange={(checked) => setExpertMode(checked)}
            />
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              When disabled, DDALAB uses sensible defaults optimized for EEG
              analysis (delays: [7, 10], MODEL encoding: 1 2 10). Expert mode
              allows you to customize delays, polynomial terms, and other
              advanced parameters in the DDA analysis panel.
            </p>
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              <strong>Tip:</strong> You can also toggle Expert Mode from the
              status bar at the bottom of the application.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="transition-shadow duration-150 hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Compass className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            Onboarding
          </CardTitle>
          <CardDescription>
            Replay the guided tour when you want a quick refresher
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Reopen the product tour to revisit file loading, analysis, sync,
            settings, and notifications.
          </p>
          <Button variant="outline" onClick={() => requestOnboardingReplay()}>
            Replay Tour
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
