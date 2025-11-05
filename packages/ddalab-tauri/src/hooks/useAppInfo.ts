import { useQuery } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";

// Query keys factory for app information
export const appInfoKeys = {
  all: ["appInfo"] as const,
  version: () => [...appInfoKeys.all, "version"] as const,
  logsPath: () => [...appInfoKeys.all, "logsPath"] as const,
  preferences: () => [...appInfoKeys.all, "preferences"] as const,
  dataDirectory: () => [...appInfoKeys.all, "dataDirectory"] as const,
};

// Get app version (cached indefinitely - only changes on app update)
export function useAppVersion() {
  return useQuery({
    queryKey: appInfoKeys.version(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        return "Web Version";
      }
      try {
        return await TauriService.getAppVersion();
      } catch (error) {
        console.error("Failed to get app version:", error);
        return "Unknown";
      }
    },
    staleTime: Infinity, // Version doesn't change without restart
    gcTime: Infinity,
    enabled: TauriService.isTauri(),
  });
}

// Get logs path (cached indefinitely - path doesn't change)
export function useLogsPath() {
  return useQuery({
    queryKey: appInfoKeys.logsPath(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        return null;
      }
      try {
        return await TauriService.getLogsPath();
      } catch (error) {
        console.error("Failed to get logs path:", error);
        return null;
      }
    },
    staleTime: Infinity, // Path doesn't change
    gcTime: Infinity,
    enabled: TauriService.isTauri(),
  });
}

// Get app preferences (cached for 5 minutes)
export function useAppPreferences() {
  return useQuery({
    queryKey: appInfoKeys.preferences(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        return null;
      }
      try {
        return await TauriService.getAppPreferences();
      } catch (error) {
        console.error("Failed to get app preferences:", error);
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: TauriService.isTauri(),
  });
}

// Get data directory (cached indefinitely - directory doesn't change)
export function useDataDirectory() {
  return useQuery({
    queryKey: appInfoKeys.dataDirectory(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        return null;
      }
      try {
        return await TauriService.getDataDirectory();
      } catch (error) {
        console.error("Failed to get data directory:", error);
        return null;
      }
    },
    staleTime: Infinity, // Directory doesn't change
    gcTime: Infinity,
    enabled: TauriService.isTauri(),
  });
}
