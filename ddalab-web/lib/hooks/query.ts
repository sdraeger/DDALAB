"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiRequestOptions } from "../utils/request";
import { snakeToCamel } from "../utils/caseConverter";

// interface UseApiQueryResult<T> {
//   loading: boolean;
//   error: Error | null;
//   data: T | null;
//   refetch: () => Promise<void>;
// }

interface UseApiQueryResult<T> {
  loading: boolean;
  error: Error | null;
  data: T | null;
  refetch: () => Promise<void>;
  updateData: (newData: T | ((prevData: T | null) => T | null)) => void;
}

interface UseApiQueryOptions extends ApiRequestOptions {
  enabled?: boolean;
}

// export function useApiQuery<T>(
//   options: UseApiQueryOptions
// ): UseApiQueryResult<T> {
//   const { enabled = true, ...requestOptions } = options;
//   const [loading, setLoading] = useState<boolean>(enabled);
//   const [error, setError] = useState<Error | null>(null);
//   const [data, setData] = useState<T | null>(null);

//   const fetchData = useCallback(async () => {
//     if (!enabled || !requestOptions.url) {
//       setLoading(false);
//       return;
//     }

//     setLoading(true);
//     setError(null);

//     try {
//       const response = await apiRequest<T>({
//         ...requestOptions,
//         responseType: "json",
//       });
//       const camelCaseResponse = snakeToCamel(response);
//       setData(camelCaseResponse);
//     } catch (err) {
//       setError(
//         err instanceof Error ? err : new Error("An unexpected error occurred")
//       );
//     } finally {
//       setLoading(false);
//     }
//   }, [
//     enabled,
//     requestOptions.url,
//     requestOptions.method,
//     requestOptions.body,
//     requestOptions.token,
//     requestOptions.headers,
//     requestOptions.contentType,
//   ]);

//   useEffect(() => {
//     fetchData();
//   }, [fetchData]);

//   const refetch = useCallback(async () => {
//     await fetchData();
//   }, [fetchData]);

//   return { loading, error, data, refetch };
// }

export function useApiQuery<T>(
  options: UseApiQueryOptions
): UseApiQueryResult<T> {
  const { enabled = true, ...requestOptions } = options;
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled || !requestOptions.url) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<T>({
        ...requestOptions,
        responseType: "json",
      });
      const camelCaseResponse = snakeToCamel(response);
      setData(camelCaseResponse);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("An unexpected error occurred")
      );
    } finally {
      setLoading(false);
    }
  }, [
    enabled,
    requestOptions.url,
    requestOptions.method,
    requestOptions.body,
    requestOptions.token,
    requestOptions.headers,
    requestOptions.contentType,
  ]);

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
