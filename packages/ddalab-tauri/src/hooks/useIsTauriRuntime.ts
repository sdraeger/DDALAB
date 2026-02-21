import { useSyncExternalStore } from "react";
import { TauriService } from "@/services/tauriService";

const subscribe = () => () => {};

/**
 * SSR-safe runtime detector for Tauri desktop mode.
 * Uses a stable server snapshot to avoid hydration mismatches.
 */
export function useIsTauriRuntime(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => TauriService.isTauri(),
    () => false,
  );
}
