"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { apiRequest, ApiRequestOptions } from "../lib/utils/request";
import { snakeToCamel } from "../lib/utils/caseConverter";
import { useUnifiedSessionData } from "./useUnifiedSession";

interface UseApiQueryResult<T> {
  loading: boolean;
  error: Error | null;
  data: T | null;
  refetch: () => Promise<void>;
  updateData: (newData: T | ((prevData: T | null) => T | null)) => void;
}

interface UseApiQueryOptions extends ApiRequestOptions {
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
  const {
    data: session,
    status,
    update: updateSession,
  } = useUnifiedSessionData();

  const fetchData = useCallback(
    async (retryCount = 0) => {
      if (!enabled || !requestOptions.url) {
        setLoading(false);
        return;
      }

      // If authentication is required but we don't have a session yet and are still loading,
      // don't make the request
      if (requiresAuth && status === "loading") {
        return;
      }

      // If authentication is required but we don't have a session, set an error
      if (requiresAuth && !session?.accessToken) {
        setError(new Error("Authentication required"));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await apiRequest<T>({
          ...requestOptions,
          responseType: "json",
          token: session?.accessToken,
        });
        const camelCaseResponse = snakeToCamel(response);
        setData(camelCaseResponse);
      } catch (err) {
        // Handle 401 Unauthorized errors
        if (
          err instanceof Error &&
          err.message.includes("401") &&
          retryOnUnauthorized &&
          retryCount < 1
        ) {
          try {
            // Try to refresh the session
            const success = await updateSession();
            if (success) {
              // Retry the request with the new token
              return fetchData(retryCount + 1);
            }
          } catch (refreshError) {
            // If refresh fails, sign out
            await signOut();
          }
        }

        setError(
          err instanceof Error ? err : new Error("An unexpected error occurred")
        );
      } finally {
        setLoading(false);
      }
    },
    [
      enabled,
      requiresAuth,
      retryOnUnauthorized,
      status,
      session?.accessToken,
      requestOptions.url,
      requestOptions.method,
      requestOptions.body,
      requestOptions.headers,
      requestOptions.contentType,
      updateSession,
    ]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

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
