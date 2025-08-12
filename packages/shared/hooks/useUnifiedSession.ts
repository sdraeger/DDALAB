import { useSession, signOut } from "next-auth/react";
import { useAuthMode } from "../contexts/AuthModeContext";

export interface UnifiedUser {
  id: string;
  name: string;
  email: string;
  firstName?: string;
  lastName?: string;
  image?: string;
  isLocalMode: boolean;
  accessToken?: string; // <-- add this line
}

export interface UnifiedSession {
  user: UnifiedUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
}

// Session data interface for raw session access
export interface UnifiedSessionData {
  data: any;
  status: "loading" | "authenticated" | "unauthenticated";
  update: (data?: any) => Promise<any>;
}

export function useUnifiedSession(): UnifiedSession {
  const { authMode } = useAuthMode();

  // In local mode, try to use the local session context
  if (authMode === "local") {
    // Check if we have a global override (set by LocalSessionProvider)
    if (typeof window !== "undefined" && (window as any).__useSessionOverride) {
      const localSession = (window as any).__useSessionOverride();
      if (localSession.data) {
        return {
          user: {
            id: localSession.data.user.id,
            name: localSession.data.user.name,
            email: localSession.data.user.email,
            firstName: localSession.data.user.firstName,
            lastName: localSession.data.user.lastName,
            image: localSession.data.user.image,
            isLocalMode: true,
            accessToken: localSession.data.accessToken, // Get accessToken from session data, not user
          },
          status: localSession.status,
        };
      }
    }

    // Fallback: return a static local user
    return {
      user: {
        id: "local-user",
        name: "Local User",
        email: "local@localhost",
        firstName: "Local",
        lastName: "User",
        image: undefined,
        isLocalMode: true,
        accessToken: "local-mode-token",
      },
      status: "authenticated",
    };
  }

  // In multi-user mode, use NextAuth session
  const { data: nextAuthSession, status: nextAuthStatus } = useSession();

  if (authMode === "multi-user") {
    if (nextAuthStatus === "loading") {
      return { user: null, status: "loading" };
    }

    if (nextAuthSession?.user) {
      return {
        user: {
          id: nextAuthSession.user.id || "",
          name: nextAuthSession.user.name || "",
          email: nextAuthSession.user.email || "",
          firstName: (nextAuthSession.user as any).firstName || undefined,
          lastName: (nextAuthSession.user as any).lastName || undefined,
          image: (nextAuthSession.user as any).image || undefined,
          isLocalMode: false,
          accessToken: (nextAuthSession.user as any).accessToken, // <-- ensure this is included!
        },
        status: "authenticated",
      };
    }

    return { user: null, status: "unauthenticated" };
  }

  // Auth mode not detected yet
  return { user: null, status: "loading" };
}

// Hook for raw session data access (for compatibility with existing code)
export function useUnifiedSessionData(): UnifiedSessionData {
  const { authMode } = useAuthMode();

  // In local mode, use the local session override
  if (authMode === "local") {
    if (typeof window !== "undefined" && (window as any).__useSessionOverride) {
      return (window as any).__useSessionOverride();
    }

    // Fallback static session
    return {
      data: {
        user: {
          id: "local-user",
          name: "Local User",
          email: "local@localhost",
          firstName: "Local",
          lastName: "User",
          isLocalMode: true,
          preferences: {
            theme: "system",
            eegZoomFactor: 0.05,
          },
        },
        accessToken: "local-mode-token",
        expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
      status: "authenticated" as const,
      update: async () => null,
    };
  }

  // In multi-user mode, use NextAuth
  return useSession();
}

// Hook for unified logout functionality
export function useUnifiedLogout() {
  const { authMode } = useAuthMode();

  const logout = async (options?: { callbackUrl?: string }) => {
    if (authMode === "local") {
      // In local mode, clear local storage and redirect
      if (typeof window !== "undefined") {
        localStorage.removeItem("dda-local-session");
        localStorage.removeItem("dda-local-preferences");
        // Clear any dashboard state as well
        const keys = Object.keys(localStorage);
        keys.forEach((key) => {
          if (key.startsWith("dda-")) {
            localStorage.removeItem(key);
          }
        });
      }
      // Redirect to login or home page
      const redirectUrl = options?.callbackUrl || "/";
      window.location.href = redirectUrl;
    } else {
      // In multi-user mode, use NextAuth signOut
      await signOut(options);
    }
  };

  return { logout };
}
