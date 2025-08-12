"use client";

import { Store } from "@reduxjs/toolkit";
import { RootState } from "../store/rootReducer";
import { useUnifiedSession } from "../hooks/useUnifiedSession";
import { sessionTokenManager } from "../lib/utils/session-token-manager";
import logger from "../lib/utils/logger";

/**
 * Manages authentication for popout windows from the main window
 * Handles token refresh requests and broadcasts auth updates
 */
export class PopoutAuthManager {
  private store: Store<RootState>;
  private isInitialized: boolean = false;
  private popoutWindows: Map<string, Window> = new Map();

  constructor(store: Store<RootState>) {
    this.store = store;
    this.initialize();
  }

  private initialize(): void {
    if (this.isInitialized || typeof window === "undefined") return;

    // Listen for auth refresh requests from popout windows
    window.addEventListener("message", this.handleMessage.bind(this));

    // Get existing popout window registry
    const registry = (window as any).__POPOUT_WINDOWS__;
    if (registry) {
      this.popoutWindows = registry;
    }

    this.isInitialized = true;
    logger.info("[PopoutAuthManager] Initialized");
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (event.data?.type === "AUTH_TOKEN_REFRESH_REQUEST") {
      await this.handleTokenRefreshRequest(event);
    }
  }

  private async handleTokenRefreshRequest(event: MessageEvent): Promise<void> {
    const { widgetId } = event.data;
    const sourceWindow = event.source as Window;

    if (!widgetId || !sourceWindow) {
      logger.warn("[PopoutAuthManager] Invalid token refresh request");
      return;
    }

    try {
      logger.info("[PopoutAuthManager] Processing token refresh request", {
        widgetId,
      });

      // Get fresh token
      const newToken = await this.getFreshToken();

      if (!newToken) {
        throw new Error("Unable to obtain fresh authentication token");
      }

      // Get updated session data
      const sessionData = await this.getSessionData();

      // Send response back to popout window
      sourceWindow.postMessage(
        {
          type: "AUTH_TOKEN_REFRESH_RESPONSE",
          widgetId,
          success: true,
          token: newToken,
          sessionData,
          timestamp: Date.now(),
        },
        "*"
      );

      // Broadcast token update to all popout windows
      this.broadcastAuthUpdate(newToken, sessionData);

      logger.info("[PopoutAuthManager] Token refresh successful", {
        widgetId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Token refresh failed";

      logger.error("[PopoutAuthManager] Token refresh failed", {
        error: errorMessage,
        widgetId,
      });

      // Send error response
      sourceWindow.postMessage(
        {
          type: "AUTH_TOKEN_REFRESH_RESPONSE",
          widgetId,
          success: false,
          error: errorMessage,
          timestamp: Date.now(),
        },
        "*"
      );
    }
  }

  private async getFreshToken(): Promise<string | null> {
    try {
      // Try to get token from session token manager
      const token = await sessionTokenManager.getToken();
      if (token) {
        return token;
      }

      // Try to get from Redux store
      const state = this.store.getState();
      if (state.auth?.user?.accessToken) {
        return state.auth.user.accessToken;
      }

      // Try to get from unified session (this will handle both local and multi-user modes)
      if (typeof window !== "undefined") {
        // Check for NextAuth session
        const nextAuthSession = sessionStorage.getItem("next-auth.session");
        if (nextAuthSession) {
          const parsed = JSON.parse(nextAuthSession);
          if (parsed.accessToken) {
            return parsed.accessToken;
          }
        }

        // Check for local session
        const localSession = localStorage.getItem("dda-local-session");
        if (localSession) {
          const parsed = JSON.parse(localSession);
          return parsed.accessToken || "local-mode-token";
        }

        // Check auth mode for local mode
        const authModeData = sessionStorage.getItem("auth-mode-context");
        if (authModeData) {
          const parsed = JSON.parse(authModeData);
          if (parsed.isLocalMode) {
            return "local-mode-token";
          }
        }
      }

      return null;
    } catch (error) {
      logger.error("[PopoutAuthManager] Error getting fresh token", { error });
      return null;
    }
  }

  private async getSessionData(): Promise<any> {
    try {
      const sessionData: any = {};

      // Get NextAuth session data
      const nextAuthSession = sessionStorage.getItem("next-auth.session");
      if (nextAuthSession) {
        sessionData.nextAuth = JSON.parse(nextAuthSession);
      }

      // Get local session data
      const localSession = localStorage.getItem("dda-local-session");
      if (localSession) {
        sessionData.localSession = JSON.parse(localSession);
      }

      // Get auth mode context
      const authModeData = sessionStorage.getItem("auth-mode-context");
      if (authModeData) {
        sessionData.authMode = JSON.parse(authModeData);
      }

      // Get user preferences
      const userPrefs = localStorage.getItem("dda-user-preferences");
      if (userPrefs) {
        sessionData.userPreferences = JSON.parse(userPrefs);
      }

      return sessionData;
    } catch (error) {
      logger.error("[PopoutAuthManager] Error getting session data", { error });
      return {};
    }
  }

  private broadcastAuthUpdate(token: string, sessionData: any): void {
    this.popoutWindows.forEach((windowRef, widgetId) => {
      try {
        if (windowRef && !windowRef.closed) {
          windowRef.postMessage(
            {
              type: "AUTH_TOKEN_UPDATE",
              widgetId,
              token,
              sessionData,
              timestamp: Date.now(),
            },
            "*"
          );
        } else {
          // Clean up closed windows
          this.popoutWindows.delete(widgetId);
        }
      } catch (error) {
        logger.warn(
          `[PopoutAuthManager] Failed to broadcast auth update to widget ${widgetId}:`,
          error
        );
      }
    });
  }

  /**
   * Manually trigger auth update broadcast to all popout windows
   */
  public async broadcastAuthUpdateToAll(): Promise<void> {
    try {
      const token = await this.getFreshToken();
      const sessionData = await this.getSessionData();

      if (token) {
        this.broadcastAuthUpdate(token, sessionData);
        logger.info(
          "[PopoutAuthManager] Broadcasted auth update to all popout windows"
        );
      }
    } catch (error) {
      logger.error("[PopoutAuthManager] Error broadcasting auth update", {
        error,
      });
    }
  }

  /**
   * Register a popout window for auth management
   */
  public registerPopoutWindow(widgetId: string, windowRef: Window): void {
    this.popoutWindows.set(widgetId, windowRef);
    logger.info(
      `[PopoutAuthManager] Registered popout window for widget: ${widgetId}`
    );
  }

  /**
   * Unregister a popout window
   */
  public unregisterPopoutWindow(widgetId: string): void {
    this.popoutWindows.delete(widgetId);
    logger.info(
      `[PopoutAuthManager] Unregistered popout window for widget: ${widgetId}`
    );
  }

  /**
   * Clean up closed windows
   */
  public cleanupClosedWindows(): void {
    const closedWindows: string[] = [];

    this.popoutWindows.forEach((windowRef, widgetId) => {
      if (!windowRef || windowRef.closed) {
        closedWindows.push(widgetId);
      }
    });

    closedWindows.forEach((widgetId) => {
      this.popoutWindows.delete(widgetId);
    });

    if (closedWindows.length > 0) {
      logger.info(
        `[PopoutAuthManager] Cleaned up ${closedWindows.length} closed windows`
      );
    }
  }

  /**
   * Destroy the auth manager
   */
  public destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.handleMessage.bind(this));
    }
    this.popoutWindows.clear();
    this.isInitialized = false;
    logger.info("[PopoutAuthManager] Destroyed");
  }
}

// Global instance for main window
let globalPopoutAuthManager: PopoutAuthManager | null = null;

/**
 * Initialize the global popout auth manager
 */
export const initializePopoutAuthManager = (
  store: Store<RootState>
): PopoutAuthManager => {
  if (!globalPopoutAuthManager) {
    globalPopoutAuthManager = new PopoutAuthManager(store);
  }
  return globalPopoutAuthManager;
};

/**
 * Get the global popout auth manager instance
 */
export const getPopoutAuthManager = (): PopoutAuthManager | null => {
  return globalPopoutAuthManager;
};
