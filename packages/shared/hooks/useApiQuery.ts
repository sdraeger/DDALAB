"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { signOut } from "next-auth/react";
import { get, post, put, _delete } from "../lib/utils/request";
import { snakeToCamel } from "../lib/utils/caseConverter";
import { useUnifiedSessionData, useUnifiedSession } from "./useUnifiedSession";
import { useAuthMode } from "../contexts/AuthModeContext";

interface UseApiQueryResult<T> {
  loading: boolean;
  error: Error | null;
  data: T | null;
  refetch: () => Promise<void>;
  updateData: (newData: T | ((prevData: T | null) => T | null)) => void;
}

interface UseApiQueryOptions {
  enabled?: boolean;
  requiresAuth?: boolean;
  retryOnUnauthorized?: boolean;
}

export function useApiQuery<T>(
  options: UseApiQueryOptions
): UseApiQueryResult<T> {
  const {
    enabled = true,
    requiresAuth = true,
    retryOnUnauthorized = true,
    ...requestOptions
  } = options;
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);
  const { user, status } = useUnifiedSession();

  // Keep updateSession from the data hook for compatibility with retry logic
  const { update: updateSession } = useUnifiedSessionData();
  const { isLocalMode } = useAuthMode();

  // Use refs to track state and prevent infinite loops
  const isMountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const lastRequestRef = useRef<string>("");
  const userRef = useRef(user);
  const hasDataRef = useRef(false);

  // Update user ref when user changes
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      console.log("[useApiQuery] Component unmounted, cleaning up");
    };
  }, []);

  const fetchData = useCallback(
    async (retryCount = 0) => {
      // Check if component is still mounted
      if (!isMountedRef.current) {
        console.log("[useApiQuery] Component unmounted, skipping request");
        return;
      }

      console.log("[useApiQuery] Starting request", {
        url: requestOptions.url,
        enabled,
        requiresAuth,
        status,
        hasUser: !!userRef.current,
        hasAccessToken: !!userRef.current?.accessToken,
        accessTokenValue: userRef.current?.accessToken ? "exists" : "missing",
        isLocalMode,
      });

      if (!enabled || !requestOptions.url) {
        if (isMountedRef.current) {
          setLoading(false);
        }
        return;
      }

      // Create a unique request identifier to prevent duplicate requests
      const actualToken = requestOptions.token || userRef.current?.accessToken;
      const requestId = `${requestOptions.url}-${requestOptions.method}-${
        requestOptions.body ? JSON.stringify(requestOptions.body) : "no-body"
      }-${actualToken ? "auth" : "no-auth"}`;

      // Prevent duplicate requests
      if (lastRequestRef.current === requestId && loading) {
        console.log("[useApiQuery] Skipping duplicate request:", requestId);
        return;
      }

      // In local mode, we don't need strict authentication checks
      if (isLocalMode) {
        console.log(
          "[useApiQuery] Local mode detected, proceeding with request"
        );
      } else {
        // In multi-user mode, we need proper authentication
        // If authentication is required but we don't have a session yet and are still loading,
        // don't make the request
        if (requiresAuth && status === "loading") {
          console.log("[useApiQuery] Waiting for session to load...");
          return;
        }

        // Check authentication using the actual token that will be used
        if (requiresAuth && !actualToken) {
          if (isMountedRef.current) {
            setError(new Error("Authentication required"));
            setLoading(false);
          }
          return;
        }

        // Additional check for invalid token values
        if (
          requiresAuth &&
          actualToken &&
          (actualToken === "" ||
            actualToken === "null" ||
            actualToken === "undefined")
        ) {
          console.log("[useApiQuery] Invalid access token, skipping request");
          if (isMountedRef.current) {
            setError(new Error("Invalid access token"));
            setLoading(false);
          }
          return;
        }
      }

      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
      }

      lastRequestRef.current = requestId;
      console.log("[useApiQuery] Making request:", requestId);

      try {
        // Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 10000); // 10 second timeout

        const requestMethod = requestOptions.method || "GET";
        let response: T;

        switch (requestMethod) {
          case "GET":
            response = await get<T>(
              requestOptions.url as string,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          case "POST":
            response = await post<T>(
              requestOptions.url as string,
              requestOptions.body,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          case "PUT":
            response = await put<T>(
              requestOptions.url as string,
              requestOptions.body,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          case "DELETE":
            response = await _delete<T>(
              requestOptions.url as string,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          default:
            throw new Error(`Unsupported HTTP method: ${requestMethod}`);
        }

        clearTimeout(timeoutId);

        if (isMountedRef.current) {
          const camelCaseResponse = snakeToCamel(response);
          setData(camelCaseResponse);
          console.log(
            "[useApiQuery] Request successful:",
            requestId,
            "Data:",
            camelCaseResponse
          );
        }
      } catch (err) {
        console.error("[useApiQuery] Request failed:", requestId, err);

        // Handle timeout errors
        if (err instanceof Error && err.name === "AbortError") {
          if (isMountedRef.current) {
            setError(new Error("Request timed out. Please try again."));
          }
          return;
        }

        // Handle connection refused errors (server not running)
        if (
          err instanceof Error &&
          (err.message.includes("ERR_CONNECTION_REFUSED") ||
            err.message.includes("net::ERR_CONNECTION_REFUSED") ||
            err.message.includes("fetch") ||
            err.message.includes("Network Error"))
        ) {
          if (isMountedRef.current) {
            setError(
              new Error(
                "Server is not available. Please check if the backend is running."
              )
            );
          }
          return;
        }

        // Handle other network errors
        if (
          err instanceof Error &&
          (err.message.includes("Network Error") ||
            err.message.includes("Failed to fetch") ||
            err.message.includes("ERR_NETWORK"))
        ) {
          if (isMountedRef.current) {
            setError(
              new Error(
                "Network error. Please check your connection and try again."
              )
            );
          }
          return;
        }

        // Handle 401 Unauthorized errors
        if (
          err instanceof Error &&
          err.message.includes("401") &&
          retryOnUnauthorized &&
          retryCount < 1
        ) {
          try {
            console.log("[useApiQuery] Attempting session refresh...");
            // Try to refresh the session
            const success = await updateSession();
            if (success && isMountedRef.current) {
              console.log(
                "[useApiQuery] Session refreshed, retrying request..."
              );
              // Retry the request with the new token
              return fetchData(retryCount + 1);
            }
          } catch (refreshError) {
            console.error(
              "[useApiQuery] Session refresh failed:",
              refreshError
            );
            // If refresh fails, sign out
            if (isMountedRef.current) {
              await signOut();
            }
          }
        }

        // Handle 401 errors when retry is disabled
        if (
          err instanceof Error &&
          err.message.includes("401") &&
          !retryOnUnauthorized
        ) {
          console.log(
            "[useApiQuery] 401 error with retry disabled, setting authentication error"
          );
          if (isMountedRef.current) {
            setError(new Error("Authentication failed. Please log in again."));
          }
          return;
        }

        if (isMountedRef.current) {
          setError(
            err instanceof Error
              ? err
              : new Error("An unexpected error occurred")
          );
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [
      enabled,
      requiresAuth,
      retryOnUnauthorized,
      status,
      requestOptions.url,
      requestOptions.method,
      requestOptions.body,
      requestOptions.headers,
      requestOptions.contentType,
      updateSession,
      isLocalMode,
      // Remove session?.accessToken from dependencies to prevent infinite loops
      // The token will be passed directly to apiRequest
    ]
  );

  // Single effect with more stable logic - inline the fetch to avoid dependency issues
  useEffect(() => {
    let isCancelled = false;

    const makeRequest = async () => {
      // Only fetch if enabled and we have the necessary data
      if (!enabled || !requestOptions.url || isCancelled) {
        if (isMountedRef.current) {
          setLoading(false);
        }
        return;
      }

      // Skip if we already have data and this is not a manual refetch
      if (hasDataRef.current && data) {
        console.log(
          "[useApiQuery] Skipping request - already have data:",
          requestOptions.url
        );
        return;
      }

      // Check if component is still mounted
      if (!isMountedRef.current) {
        return;
      }

      // In local mode, we can proceed without strict authentication checks
      if (isLocalMode) {
        console.log("[useApiQuery] Local mode - proceeding with request");
      } else {
        // In multi-user mode, we need proper authentication
        if (requiresAuth && status === "loading") {
          console.log("[useApiQuery] Waiting for session to load...");
          return;
        }

        // Check authentication using the actual token that will be used
        const actualToken =
          requestOptions.token || userRef.current?.accessToken;
        if (requiresAuth && !actualToken) {
          if (isMountedRef.current) {
            setError(new Error("Authentication required"));
            setLoading(false);
          }
          return;
        }
      }

      if (isCancelled || !isMountedRef.current) {
        return;
      }

      // Set loading state
      setLoading(true);
      setError(null);

      try {
        const requestMethod = requestOptions.method || "GET";
        let response: T;

        switch (requestMethod) {
          case "GET":
            response = await get<T>(
              requestOptions.url as string,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          case "POST":
            response = await post<T>(
              requestOptions.url as string,
              requestOptions.body,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          case "PUT":
            response = await put<T>(
              requestOptions.url as string,
              requestOptions.body,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          case "DELETE":
            response = await _delete<T>(
              requestOptions.url as string,
              requestOptions.token || userRef.current?.accessToken
            );
            break;
          default:
            throw new Error(`Unsupported HTTP method: ${requestMethod}`);
        }

        if (isCancelled || !isMountedRef.current) {
          return;
        }

        const camelCaseResponse = snakeToCamel(response);
        setData(camelCaseResponse);
        hasDataRef.current = true;
        console.log(
          "[useApiQuery] Request successful:",
          requestOptions.url,
          "Response:",
          camelCaseResponse
        );
      } catch (err) {
        console.error("[useApiQuery] Request failed:", err);

        if (isCancelled || !isMountedRef.current) {
          return;
        }

        setError(
          err instanceof Error ? err : new Error("An unexpected error occurred")
        );
      } finally {
        if (!isCancelled && isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    makeRequest();

    return () => {
      isCancelled = true;
    };
  }, [
    enabled,
    requiresAuth,
    status,
    requestOptions.url,
    requestOptions.method,
    requestOptions.body,
    requestOptions.token,
    isLocalMode,
  ]);

  const refetch = useCallback(async () => {
    retryCountRef.current = 0;
    lastRequestRef.current = "";
    hasDataRef.current = false; // Reset data flag on manual refetch
    // Trigger a re-render by updating a dependency
    setLoading(true);
  }, []);

  const updateData = useCallback(
    (newData: T | ((prevData: T | null) => T | null)) => {
      setData((prev) => {
        if (typeof newData === "function") {
          return (newData as (prevData: T | null) => T | null)(prev);
        }
        return newData;
      });
    },
    []
  );

  return { loading, error, data, refetch, updateData };
}
