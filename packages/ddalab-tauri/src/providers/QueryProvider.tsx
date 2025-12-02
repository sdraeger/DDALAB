"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, useEffect } from "react";

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

  // Store reference to queryClient for use outside React
  useEffect(() => {
    globalQueryClient = queryClient;
    return () => {
      globalQueryClient = null;
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children as any}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
