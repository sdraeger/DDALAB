/**
 * Hooks for accessing shared content
 */
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ShareMetadata, SharedResultInfo } from "@/types/sync";

interface SharedItem extends ShareMetadata {
  owner_name?: string;
}

/** Default stale time for share lists (30 seconds) */
const SHARES_STALE_TIME = 30 * 1000;

/** Default stale time for individual share access (5 minutes) */
const SHARE_ACCESS_STALE_TIME = 5 * 60 * 1000;

/**
 * Get content shared with the current user
 */
export function useSharedWithMe() {
  return useQuery({
    queryKey: ["shares", "with-me"],
    queryFn: async () => {
      return invoke<SharedItem[]>("sync_list_shared_with_me");
    },
    staleTime: SHARES_STALE_TIME,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}

/**
 * Get content the current user has shared
 */
export function useMyShares() {
  return useQuery({
    queryKey: ["shares", "my-shares"],
    queryFn: async () => {
      return invoke<ShareMetadata[]>("sync_list_my_shares");
    },
    staleTime: SHARES_STALE_TIME,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}

/**
 * Access a specific share by token
 */
export function useAccessShare(token: string) {
  return useQuery({
    queryKey: ["shares", "access", token],
    queryFn: async () => {
      return invoke<SharedResultInfo>("sync_access_share", { token });
    },
    enabled: !!token,
    staleTime: SHARE_ACCESS_STALE_TIME,
    retry: 1,
  });
}
