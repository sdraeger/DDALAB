import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { TauriService } from "@/services/tauriService";

export interface UpdateStatus {
  available: boolean;
  current_version: string;
  latest_version?: string;
  release_notes?: string;
  release_date?: string;
}

// Get the last checked date from app preferences
async function getLastCheckedDate(): Promise<Date | null> {
  try {
    if (!TauriService.isTauri()) return null;
    const prefs = await TauriService.getAppPreferences();
    if (prefs.updates_last_checked) {
      return new Date(prefs.updates_last_checked);
    }
  } catch (error) {
    console.error("[useUpdates] Failed to get last checked date:", error);
  }
  return null;
}

// Save the last checked date to app preferences
async function setLastCheckedDate(date: Date): Promise<void> {
  try {
    if (!TauriService.isTauri()) return;
    const prefs = await TauriService.getAppPreferences();
    await TauriService.saveAppPreferences({
      ...prefs,
      updates_last_checked: date.toISOString(),
    });
  } catch (error) {
    console.error("[useUpdates] Failed to save last checked date:", error);
  }
}

// Hook to get the last checked date
export function useLastCheckedDate(): Date | null {
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    getLastCheckedDate().then(setLastChecked);
  }, []);

  return lastChecked;
}

// Query keys factory for updates
export const updatesKeys = {
  all: ["updates"] as const,
  status: () => [...updatesKeys.all, "status"] as const,
};

// Check for updates (manual only - don't want to spam the server)
export function useUpdateStatus(options?: { enabled?: boolean }) {
  return useQuery<UpdateStatus>({
    queryKey: updatesKeys.status(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error("Update checking only available in Tauri");
      }
      return await TauriService.checkNativeUpdate();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - updates don't change that frequently
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: options?.enabled ?? false, // Manual only by default - don't auto-check
    retry: 1,
  });
}

// Check for updates (manual trigger)
export function useCheckForUpdates() {
  const queryClient = useQueryClient();
  const [lastChecked, setLastCheckedState] = useState<Date | null>(null);

  // Load last checked date from preferences on mount
  useEffect(() => {
    getLastCheckedDate().then(setLastCheckedState);
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error("Update checking only available in Tauri");
      }
      return await TauriService.checkNativeUpdate();
    },
    onSuccess: async (data) => {
      // Update the cache with the result
      queryClient.setQueryData(updatesKeys.status(), data);
      // Persist the last checked date
      const now = new Date();
      await setLastCheckedDate(now);
      setLastCheckedState(now);
    },
  });

  return { ...mutation, lastChecked };
}

// Download and install update
export function useDownloadAndInstallUpdate() {
  return useMutation({
    mutationFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error("Update installation only available in Tauri");
      }
      await TauriService.downloadAndInstallUpdate();
    },
    // Note: After successful installation, the app will likely restart
    // so we don't need to invalidate cache
  });
}
