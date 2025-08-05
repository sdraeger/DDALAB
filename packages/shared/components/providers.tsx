"use client";

import React, { ReactNode, createContext, useContext, useState, useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "shared/components/theme/ThemeProvider";
import { ReduxProvider } from "shared/providers/ReduxProvider";
import { AuthModeProvider, useAuthMode } from "shared/contexts/AuthModeContext";
import { DashboardStateProvider } from "shared/contexts/DashboardStateContext";
import { PersistentPlotsProvider } from "shared/contexts/PersistentPlotsContext";
import { SettingsProvider } from "shared/contexts/SettingsContext";
import { ThemeInitializer } from "shared/components/theme/ThemeInitializer";

// Local session context that mimics NextAuth's session structure
const LocalSessionContext = createContext({
  data: null as any,
  status: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
  update: async () => null,
});

// Custom hook that mimics NextAuth's useSession for local mode
function useLocalSession() {
  return useContext(LocalSessionContext);
}

// Provider that supplies a local user session without API calls
function LocalSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState({
    data: {
      user: {
        id: "local-user",
        name: "Local User",
        email: "local@localhost",
        firstName: "Local",
        lastName: "User",
        isLocalMode: true,
        preferences: {
          theme: "system" as const,
          eegZoomFactor: 0.05,
        },
      },
      accessToken: "local-mode-token",
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
    },
    status: "authenticated" as const,
    update: async () => null,
  });

  // Save session to localStorage for persistence
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedSession = localStorage.getItem('dda-local-session');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        setSession(prev => ({ ...prev, data: { ...prev.data, ...parsed } }));
      } catch (error) {
        console.warn('Failed to parse saved local session:', error);
      }
    } else {
      // Save the default session
      localStorage.setItem('dda-local-session', JSON.stringify(session.data));
    }
  }, []);

  // Update localStorage when session changes
  const updateSession = React.useCallback(async (data?: any) => {
    if (data) {
      const updatedSession = { ...session.data, ...data };
      setSession(prev => ({ ...prev, data: updatedSession }));
      if (typeof window !== 'undefined') {
        localStorage.setItem('dda-local-session', JSON.stringify(updatedSession));
      }
    }
    return null;
  }, [session.data]);

  const contextValue = React.useMemo(() => ({
    data: session.data,
    status: session.status,
    update: updateSession,
  }), [session.data, session.status, updateSession]);

  return (
    <LocalSessionContext.Provider value={contextValue}>
      {children}
    </LocalSessionContext.Provider>
  );
}

// Override the useSession hook to use local session in local mode
declare global {
  var __useSessionOverride: any;
}

// Auto-login handler for local mode
function AutoLoginHandler({ children }: { children: ReactNode }) {
  const { authMode } = useAuthMode();

  // Show loading while auth mode is being detected
  if (!authMode) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">Detecting authentication mode...</span>
      </div>
    );
  }

  // Set up the session override based on auth mode, but keep the same provider structure
  React.useEffect(() => {
    if (authMode === 'local') {
      if (typeof window !== 'undefined') {
        console.log("[AutoLoginHandler] Setting local session override");
        window.__useSessionOverride = useLocalSession;
      }
    } else {
      if (typeof window !== 'undefined') {
        console.log("[AutoLoginHandler] Clearing session override");
        window.__useSessionOverride = null;
      }
    }
  }, [authMode]);

  console.log("[AutoLoginHandler] Rendering providers with auth mode:", authMode);

  // Always return the same provider structure to prevent remounting
  return (
    <LocalSessionProvider>
      <SessionProvider>
        <SettingsProvider>
          <ThemeInitializer />
          {children}
        </SettingsProvider>
      </SessionProvider>
    </LocalSessionProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ReduxProvider>
      <AuthModeProvider>
        <AutoLoginHandler>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <DashboardStateProvider>
              <PersistentPlotsProvider>
                {children}
              </PersistentPlotsProvider>
            </DashboardStateProvider>
          </ThemeProvider>
        </AutoLoginHandler>
      </AuthModeProvider>
    </ReduxProvider>
  );
}
