"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { TauriService } from "@/services/tauriService";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // useEffect only runs on the client, so now we can safely show the UI
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Sync native window theme with app theme
  React.useEffect(() => {
    if (!mounted || !TauriService.isTauri()) return;

    const syncWindowTheme = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();

        // Set window theme based on current theme
        // 'light' or 'dark' (next-themes uses these values)
        await appWindow.setTheme(theme === "dark" ? "dark" : "light");
      } catch (error) {
        console.error("Failed to sync window theme:", error);
      }
    };

    syncWindowTheme();
  }, [theme, mounted]);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon">
        <Sun className="h-5 w-5" />
      </Button>
    );
  }

  const handleToggle = async () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);

    // Sync native window theme immediately for better UX
    if (TauriService.isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        await appWindow.setTheme(newTheme);
      } catch (error) {
        console.error("Failed to update window theme:", error);
      }
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
