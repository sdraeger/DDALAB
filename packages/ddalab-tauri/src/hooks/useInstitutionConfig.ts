import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { InstitutionConfig } from "@/types/sync";

const INSTITUTION_CONFIG_KEY = ["institutionConfig"];

/**
 * Default institution config used as placeholder while loading
 * This allows components to render immediately without waiting for the backend
 */
const DEFAULT_INSTITUTION_CONFIG: InstitutionConfig = {
  id: "default",
  name: "My Institution",
  hipaa_mode: true,
  allow_federation: false,
  default_share_expiry_days: 30,
};

/**
 * Fetch the current institution configuration
 */
async function fetchInstitutionConfig(): Promise<InstitutionConfig> {
  return invoke<InstitutionConfig>("get_institution_config");
}

/**
 * Update institution configuration (admin only)
 */
async function updateInstitutionConfig(
  config: Partial<InstitutionConfig>,
): Promise<InstitutionConfig> {
  return invoke<InstitutionConfig>("update_institution_config", { config });
}

/**
 * Hook for accessing and managing institution configuration
 */
export function useInstitutionConfig() {
  const queryClient = useQueryClient();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: INSTITUTION_CONFIG_KEY,
    queryFn: fetchInstitutionConfig,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
    // Use placeholder data to render immediately while fetching
    // This prevents the "Loading..." flash when switching tabs
    placeholderData: DEFAULT_INSTITUTION_CONFIG,
  });

  const updateMutation = useMutation({
    mutationFn: updateInstitutionConfig,
    onSuccess: (newConfig) => {
      queryClient.setQueryData(INSTITUTION_CONFIG_KEY, newConfig);
    },
  });

  return {
    config,
    isLoading,
    error: error as Error | null,
    refetch,

    // Derived state
    isHipaaMode: config?.hipaa_mode ?? true,
    allowsFederation: config?.allow_federation ?? false,
    defaultExpiryDays: config?.default_share_expiry_days ?? 30,

    // Actions
    updateConfig: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error as Error | null,
  };
}

/**
 * Hook for just reading HIPAA mode (lightweight)
 */
export function useHipaaMode(): boolean {
  const { data } = useQuery({
    queryKey: INSTITUTION_CONFIG_KEY,
    queryFn: fetchInstitutionConfig,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return data?.hipaa_mode ?? true; // Default to true for safety
}
