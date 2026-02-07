import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";

export const cliKeys = {
  all: ["cli"] as const,
  status: () => [...cliKeys.all, "status"] as const,
};

export function useCliInstallStatus() {
  return useQuery<boolean>({
    queryKey: cliKeys.status(),
    queryFn: async () => {
      if (!TauriService.isTauri()) return false;
      return await TauriService.getCliInstallStatus();
    },
    staleTime: 30 * 1000,
    enabled: TauriService.isTauri(),
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
