import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";
import { useIsTauriRuntime } from "@/hooks/useIsTauriRuntime";

export const cliKeys = {
  all: ["cli"] as const,
  status: () => [...cliKeys.all, "status"] as const,
};

export function useCliInstallStatus() {
  const isTauriRuntime = useIsTauriRuntime();
  return useQuery<boolean>({
    queryKey: cliKeys.status(),
    queryFn: async () => {
      if (!isTauriRuntime) return false;
      return await TauriService.getCliInstallStatus();
    },
    staleTime: 30 * 1000,
    enabled: isTauriRuntime,
  });
}

export function useInstallCli() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => TauriService.installCli(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cliKeys.status() });
    },
  });
}

export function useUninstallCli() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => TauriService.uninstallCli(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cliKeys.status() });
    },
  });
}
