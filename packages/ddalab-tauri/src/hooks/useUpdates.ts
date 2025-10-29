import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TauriService } from '@/services/tauriService'

export interface UpdateStatus {
  available: boolean
  current_version: string
  latest_version?: string
  release_notes?: string
  release_date?: string
}

// Query keys factory for updates
export const updatesKeys = {
  all: ['updates'] as const,
  status: () => [...updatesKeys.all, 'status'] as const,
}

// Check for updates (manual only - don't want to spam the server)
export function useUpdateStatus(options?: { enabled?: boolean }) {
  return useQuery<UpdateStatus>({
    queryKey: updatesKeys.status(),
    queryFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error('Update checking only available in Tauri')
      }
      return await TauriService.checkNativeUpdate()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - updates don't change that frequently
    gcTime: 30 * 60 * 1000, // 30 minutes
    enabled: options?.enabled ?? false, // Manual only by default - don't auto-check
    retry: 1,
  })
}

// Check for updates (manual trigger)
export function useCheckForUpdates() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error('Update checking only available in Tauri')
      }
      return await TauriService.checkNativeUpdate()
    },
    onSuccess: (data) => {
      // Update the cache with the result
      queryClient.setQueryData(updatesKeys.status(), data)
    },
  })
}

// Download and install update
export function useDownloadAndInstallUpdate() {
  return useMutation({
    mutationFn: async () => {
      if (!TauriService.isTauri()) {
        throw new Error('Update installation only available in Tauri')
      }
      await TauriService.downloadAndInstallUpdate()
    },
    // Note: After successful installation, the app will likely restart
    // so we don't need to invalidate cache
  })
}
