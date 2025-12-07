/**
 * State Manager Provider
 *
 * Registers the Zustand state manager implementation on app startup.
 * This enables services to use the state manager abstraction.
 */

"use client";

import { useEffect, useState } from "react";
import { registerStateManager } from "@/services/stateManager";
import { createZustandStateManager } from "@/services/zustandStateManager";

let isRegistered = false;

/**
 * Provider component that registers the state manager.
 * Should be placed near the root of the app, inside the Zustand store context.
 */
export function StateManagerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(isRegistered);

  useEffect(() => {
    if (!isRegistered) {
      // Register the Zustand implementation
      registerStateManager(createZustandStateManager);
      isRegistered = true;
      setReady(true);
    }
  }, []);

  // Render children immediately - state manager is synchronously available
  // after first registration
  if (!ready && !isRegistered) {
    // First render before useEffect runs - register synchronously
    registerStateManager(createZustandStateManager);
    isRegistered = true;
  }

  return <>{children}</>;
}
