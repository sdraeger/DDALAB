import { getSession } from "next-auth/react";

class SessionTokenManager {
  private static instance: SessionTokenManager;
  private localToken: string | null = null;
  private isLocalMode: boolean = false;

  private constructor() {
    // Initialize by checking localStorage
    if (typeof window !== "undefined") {
      try {
        const savedSession = localStorage.getItem("dda-local-session");
        if (savedSession) {
          const parsedSession = JSON.parse(savedSession);
          this.localToken = parsedSession.accessToken || null;
          this.isLocalMode = true;
        }
      } catch (error) {
        console.warn("Failed to initialize session token manager:", error);
      }
    }
  }

  public static getInstance(): SessionTokenManager {
    if (!SessionTokenManager.instance) {
      SessionTokenManager.instance = new SessionTokenManager();
    }
    return SessionTokenManager.instance;
  }

  public async getToken(): Promise<string | null> {
    // If we're in local mode, return the local token
    if (this.isLocalMode && this.localToken) {
      return this.localToken;
    }

    // Otherwise, try to get NextAuth session
    try {
      const session = await getSession();
      return session?.accessToken || null;
    } catch (error) {
      console.warn("Failed to get NextAuth session token:", error);
      return null;
    }
  }

  public updateLocalToken(token: string | null): void {
    this.localToken = token;
    this.isLocalMode = true;
  }

  public setLocalMode(isLocal: boolean): void {
    this.isLocalMode = isLocal;
  }
}

export const sessionTokenManager = SessionTokenManager.getInstance();
