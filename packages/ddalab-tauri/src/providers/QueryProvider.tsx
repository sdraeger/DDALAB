"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { preloadWasm } from "@/hooks/useWasm";

// Global queryClient reference for use outside of React components (e.g., search providers)
let globalQueryClient: QueryClient | null = null;

export function getQueryClient(): QueryClient | null {
  return globalQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
            retry: 2,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
  );
  const [DevtoolsComponent, setDevtoolsComponent] =
    useState<React.ComponentType<{
      initialIsOpen?: boolean;
    }> | null>(null);

  // Keep devtools opt-in to avoid loading heavy date-fns/devtools code
  // in the critical startup path (improves first-load stability in Tauri dev).
  const enableDevtools =
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_ENABLE_RQ_DEVTOOLS === "true";

  // Store reference to queryClient for use outside React
  useEffect(() => {
    globalQueryClient = queryClient;
    return () => {
      globalQueryClient = null;
    };
  }, [queryClient]);

  // Preload WASM module for signal processing at app startup
  useEffect(() => {
    preloadWasm();
  }, []);

  // Lazy-load React Query Devtools only when explicitly enabled.
  useEffect(() => {
    if (!enableDevtools) return;

    let cancelled = false;
    void import("@tanstack/react-query-devtools")
      .then((mod) => {
        if (!cancelled) {
          setDevtoolsComponent(() => mod.ReactQueryDevtools);
        }
      })
      .catch(() => {
        // Non-fatal: devtools are optional.
      });

    return () => {
      cancelled = true;
    };
  }, [enableDevtools]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {DevtoolsComponent ? <DevtoolsComponent initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
