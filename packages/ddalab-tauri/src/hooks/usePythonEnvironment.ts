import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TauriService } from "@/services/tauriService";

export interface PythonEnvironmentInfo {
  detected: boolean;
  pythonPath: string | null;
  hasMne: boolean;
  mneVersion: string | null;
}

export const pythonKeys = {
  all: ["python"] as const,
  environment: () => [...pythonKeys.all, "environment"] as const,
};

export function usePythonEnvironment() {
  return useQuery<PythonEnvironmentInfo>({
    queryKey: pythonKeys.environment(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        return {
          detected: false,
          pythonPath: null,
          hasMne: false,
          mneVersion: null,
        };
      }
      return await TauriService.detectPythonEnvironment();
    },
    staleTime: 60 * 1000,
    enabled: TauriService.isTauri(),
  });
}

export function useTestPythonPath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => TauriService.testPythonPath(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pythonKeys.environment() });
    },
  });
}
