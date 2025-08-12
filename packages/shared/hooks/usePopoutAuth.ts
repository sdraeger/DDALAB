"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { setUser, logout } from "../store/slices/authSlice";
import logger from "../lib/utils/logger";

interface PopoutAuthOptions {
  widgetId: string;
  isPopout?: boolean;
  onAuthError?: (error: string) => void;
  onTokenRefresh?: (token: string) => void;
}

interface AuthTokenInfo {
  token: string | null;
  expiresAt: number | null;
  isValid: boolean;
  needsRefresh: boolean;
}

/**
 * Hook to manage authentication context in popout windows
 * Handles token refresh, session synchronization, and auth state management
 */
export function usePopoutAuth({
  widgetId,
  isPopout = false,
  onAuthError,
  onTokenRefresh,
}: PopoutAuthOptions) {
  const dispatch = useAppDispatch();
  const authState = useAppSelector((state) => state.auth);
  const [tokenInfo, setTokenInfo] = useState<AuthTokenInfo>({
    token: null,
    expiresAt: null,
    isValid: false,
    needsRefresh: false,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize authentication context for popout windows
  useEffect(() => {
    if (!isPopout) return;

    const initializeAuth = async () => {
      try {
        logger.info("[usePopoutAuth] Initializing authentication context", {
          widgetId,
        });

        // Get stored auth token
        const storedToken = sessionStorage.getItem("popout-auth-token");
        const sessionData = sessionStorage.getItem("popout-session");

        if (storedToken && sessionData) {
          const parsedSessionData = JSON.parse(sessionData);

          // Validate token
          const tokenValidation = await validateToken(storedToken);

          if (tokenValidation.isValid) {
            setTokenInfo({
              token: storedToken,
              expiresAt: tokenValidation.expiresAt,
              isValid: true,
              needsRefresh: tokenValidation.needsRefresh,
            });

            // Update Redux auth state if we have user data
            if (
              parsedSessionData.nextAuth?.user ||
              parsedSessionData.localSession?.user
            ) {
              const userData =
                parsedSessionData.nextAuth?.user ||
                parsedSessionData.localSession?.user;
              dispatch(
                setUser({
                  ...userData,
                  accessToken: storedToken,
                })
              );
            }

            // Schedule token refresh if needed
            if (tokenValidation.needsRefresh) {
              scheduleTokenRefresh(tokenValidation.expiresAt);
            }

            logger.info(
              "[usePopoutAuth] Authentication context initialized successfully"
            );
          } else {
            throw new Error("Invalid authentication token");
          }
        } else {
          throw new Error("No authentication data found");
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Authentication initialization failed";
        logger.error("[usePopoutAuth] Failed to initialize authentication", {
          error: errorMessage,
          widgetId,
        });

        setTokenInfo({
          token: null,
          expiresAt: null,
          isValid: false,
          needsRefresh: false,
        });

        onAuthError?.(errorMessage);
      }
    };

    initializeAuth();
  }, [widgetId, isPopout, dispatch, onAuthError]);

  // Listen for authentication updates from main window
  useEffect(() => {
    if (!isPopout) return;

    const handleAuthUpdate = (event: MessageEvent) => {
      if (
        event.data?.type === "AUTH_TOKEN_UPDATE" &&
        event.data?.widgetId === widgetId
      ) {
        const { token, sessionData } = event.data;

        logger.info(
          "[usePopoutAuth] Received auth token update from main window"
        );

        // Update stored token
        sessionStorage.setItem("popout-auth-token", token);
        if (sessionData) {
          sessionStorage.setItem("popout-session", JSON.stringify(sessionData));
        }

        // Validate and update token info
        validateToken(token).then((validation) => {
          setTokenInfo({
            token,
            expiresAt: validation.expiresAt,
            isValid: validation.isValid,
            needsRefresh: validation.needsRefresh,
          });

          if (validation.needsRefresh) {
            scheduleTokenRefresh(validation.expiresAt);
          }

          onTokenRefresh?.(token);
        });
      }
    };

    window.addEventListener("message", handleAuthUpdate);
    return () => window.removeEventListener("message", handleAuthUpdate);
  }, [widgetId, isPopout, onTokenRefresh]);

  // Token validation function
  const validateToken = useCallback(
    async (
      token: string
    ): Promise<{
      isValid: boolean;
      expiresAt: number | null;
      needsRefresh: boolean;
    }> => {
      try {
        // For local mode, tokens are always valid
        if (token === "local-mode-token") {
          return {
            isValid: true,
            expiresAt: null,
            needsRefresh: false,
          };
        }

        // For JWT tokens, decode and check expiration
        if (token.includes(".")) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            const expiresAt = payload.exp * 1000; // Convert to milliseconds
            const now = Date.now();
            const timeUntilExpiry = expiresAt - now;

            return {
              isValid: timeUntilExpiry > 0,
              expiresAt,
              needsRefresh: timeUntilExpiry < 5 * 60 * 1000, // Refresh if less than 5 minutes
            };
          } catch {
            // If we can't decode the token, assume it's valid for now
            return {
              isValid: true,
              expiresAt: null,
              needsRefresh: false,
            };
          }
        }

        // For other token types, assume valid
        return {
          isValid: true,
          expiresAt: null,
          needsRefresh: false,
        };
      } catch (error) {
        logger.warn("[usePopoutAuth] Token validation failed", { error });
        return {
          isValid: false,
          expiresAt: null,
          needsRefresh: false,
        };
      }
    },
    []
  );

  // Schedule token refresh
  const scheduleTokenRefresh = useCallback(
    (expiresAt: number | null) => {
      if (!expiresAt || !isPopout) return;

      // Clear existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }

      const now = Date.now();
      const timeUntilRefresh = Math.max(0, expiresAt - now - 2 * 60 * 1000); // Refresh 2 minutes before expiry

      refreshTimeoutRef.current = setTimeout(() => {
        requestTokenRefresh();
      }, timeUntilRefresh);

      logger.info("[usePopoutAuth] Scheduled token refresh", {
        expiresAt: new Date(expiresAt).toISOString(),
        refreshIn: timeUntilRefresh / 1000 / 60, // minutes
      });
    },
    [isPopout]
  );

  // Request token refresh from main window
  const requestTokenRefresh = useCallback(async () => {
    if (!isPopout || isRefreshing) return;

    setIsRefreshing(true);

    try {
      logger.info("[usePopoutAuth] Requesting token refresh from main window");

      // Send refresh request to main window
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          {
            type: "AUTH_TOKEN_REFRESH_REQUEST",
            widgetId,
            timestamp: Date.now(),
          },
          "*"
        );

        // Wait for response with timeout
        const refreshPromise = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Token refresh timeout"));
          }, 10000); // 10 second timeout

          const handleRefreshResponse = (event: MessageEvent) => {
            if (
              event.data?.type === "AUTH_TOKEN_REFRESH_RESPONSE" &&
              event.data?.widgetId === widgetId
            ) {
              clearTimeout(timeout);
              window.removeEventListener("message", handleRefreshResponse);

              if (event.data.success) {
                resolve(event.data.token);
              } else {
                reject(new Error(event.data.error || "Token refresh failed"));
              }
            }
          };

          window.addEventListener("message", handleRefreshResponse);
        });

        const newToken = await refreshPromise;

        // Update token info
        const validation = await validateToken(newToken);
        setTokenInfo({
          token: newToken,
          expiresAt: validation.expiresAt,
          isValid: validation.isValid,
          needsRefresh: validation.needsRefresh,
        });

        // Schedule next refresh
        if (validation.expiresAt) {
          scheduleTokenRefresh(validation.expiresAt);
        }

        onTokenRefresh?.(newToken);
        logger.info("[usePopoutAuth] Token refresh successful");
      } else {
        throw new Error("Main window not available for token refresh");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Token refresh failed";
      logger.error("[usePopoutAuth] Token refresh failed", {
        error: errorMessage,
        widgetId,
      });

      // Clear auth state on refresh failure
      setTokenInfo({
        token: null,
        expiresAt: null,
        isValid: false,
        needsRefresh: false,
      });

      dispatch(logout());
      onAuthError?.(errorMessage);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isPopout,
    isRefreshing,
    widgetId,
    validateToken,
    scheduleTokenRefresh,
    onTokenRefresh,
    onAuthError,
    dispatch,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Manual token refresh function
  const refreshToken = useCallback(() => {
    if (isPopout) {
      requestTokenRefresh();
    }
  }, [isPopout, requestTokenRefresh]);

  return {
    tokenInfo,
    isRefreshing,
    refreshToken,
    isAuthenticated: tokenInfo.isValid && !!tokenInfo.token,
    authState,
  };
}
