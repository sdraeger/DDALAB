"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { TauriService } from "@/services/tauriService";
import { useAppStore } from "@/store/appStore";

const THEME_CYCLE = ["light", "dark", "system"] as const;

const THEME_LABELS: Record<string, string> = {
  light: "light",
  dark: "dark",
  system: "system",
};

function ThemeIcon({ theme }: { theme: string }) {
  switch (theme) {
    case "dark":
      return <Moon className="h-5 w-5" aria-hidden="true" />;
    case "system":
      return <Monitor className="h-5 w-5" aria-hidden="true" />;
    default:
      return <Sun className="h-5 w-5" aria-hidden="true" />;
  }
}

export function ThemeToggle() {
  const { theme, setTheme: setNextTheme } = useTheme();
  const storeSetTheme = useAppStore((state) => state.setTheme);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Sync native Tauri window chrome with the resolved theme
  React.useEffect(() => {
    if (!mounted || !TauriService.isTauri()) return;

    const syncWindowTheme = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        await appWindow.setTheme(theme === "dark" ? "dark" : "light");
      } catch {
        // Non-critical
      }
    };

    syncWindowTheme();
  }, [theme, mounted]);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Toggle theme">
        <Sun className="h-5 w-5" aria-hidden="true" />
      </Button>
    );
  }

  const handleToggle = () => {
    const currentIndex = THEME_CYCLE.indexOf(
      theme as (typeof THEME_CYCLE)[number],
    );
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    const newTheme = THEME_CYCLE[nextIndex];

    setNextTheme(newTheme);
    storeSetTheme(newTheme === "system" ? "auto" : newTheme);
  };

  const nextTheme =
    THEME_CYCLE[
      (THEME_CYCLE.indexOf(theme as (typeof THEME_CYCLE)[number]) + 1) %
        THEME_CYCLE.length
    ];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      title={`Switch to ${THEME_LABELS[nextTheme] ?? "light"} mode`}
      aria-label={`Switch to ${THEME_LABELS[nextTheme] ?? "light"} mode`}
    >
      <ThemeIcon theme={theme ?? "light"} />
    </Button>
  );
}
