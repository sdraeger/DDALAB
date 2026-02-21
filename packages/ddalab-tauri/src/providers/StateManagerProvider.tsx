/**
 * State Manager Provider
 *
 * Registers the Zustand state manager implementation on app startup.
 * This enables services to use the state manager abstraction.
 */

"use client";

import { registerStateManager } from "@/services/stateManager";
import { createZustandStateManager } from "@/services/zustandStateManager";

let hasRegisteredStateManager = false;

function ensureStateManagerRegistered() {
  if (hasRegisteredStateManager) return;
  registerStateManager(createZustandStateManager);
  hasRegisteredStateManager = true;
}

// Register once at module initialization to keep render phase pure.
ensureStateManagerRegistered();

/**
 * Provider component that registers the state manager.
 * Should be placed near the root of the app, inside the Zustand store context.
 */
export function StateManagerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
