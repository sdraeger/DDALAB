"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { ApiService } from "@/services/apiService";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ApiServiceContext");

interface ApiServiceContextValue {
  /** The ApiService instance */
  apiService: ApiService;
  /** Whether the API service has a valid session token */
  isAuthenticated: boolean;
  /** Whether the API service is ready for use */
  isReady: boolean;
  /** Update the session token */
  setSessionToken: (token: string) => void;
  /** Get the current base URL */
  baseURL: string;
}

const ApiServiceContext = createContext<ApiServiceContextValue | null>(null);

interface ApiServiceProviderProps {
  children: ReactNode;
  /** The base URL for the API */
  apiUrl: string;
  /** Optional initial session token */
  sessionToken?: string;
}

export function ApiServiceProvider({
  children,
  apiUrl,
  sessionToken: initialToken,
}: ApiServiceProviderProps) {
  // Create the ApiService instance - memoized to avoid recreation
  const [apiService, setApiService] = useState<ApiService>(() => {
    return new ApiService(apiUrl, initialToken);
  });

  const [isAuthenticated, setIsAuthenticated] = useState(!!initialToken);
  const [isReady, setIsReady] = useState(!!initialToken);

  useEffect(() => {
    if (apiService.baseURL !== apiUrl) {
      const newService = new ApiService(
        apiUrl,
        apiService.getSessionToken() || undefined,
      );
      setApiService(newService);
    }
  }, [apiUrl, apiService]);

  useEffect(() => {
    const currentToken = apiService.getSessionToken();
    logger.debug("Token sync effect triggered", {
      hasInitialToken: !!initialToken,
      currentToken: currentToken ? currentToken.substring(0, 8) + "..." : null,
      initialToken: initialToken ? initialToken.substring(0, 8) + "..." : null,
      tokensDiffer: currentToken !== initialToken,
    });

    if (initialToken && currentToken !== initialToken) {
      logger.info("Syncing session token to ApiService");
      apiService.setSessionToken(initialToken);
      setIsAuthenticated(true);
      setIsReady(true);
      logger.info("Dispatching api-service-auth-ready event");
      window.dispatchEvent(new CustomEvent("api-service-auth-ready"));
    }
  }, [initialToken, apiService]);

  // Callback to update session token
  const setSessionToken = useCallback(
    (token: string) => {
      apiService.setSessionToken(token);
      setIsAuthenticated(true);
      setIsReady(true);

      // Dispatch event to signal that auth is ready
      window.dispatchEvent(new CustomEvent("api-service-auth-ready"));
    },
    [apiService],
  );

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo<ApiServiceContextValue>(
    () => ({
      apiService,
      isAuthenticated,
      isReady,
      setSessionToken,
      baseURL: apiService.baseURL,
    }),
    [apiService, isAuthenticated, isReady, setSessionToken],
  );

  return (
    <ApiServiceContext.Provider value={contextValue}>
      {children}
    </ApiServiceContext.Provider>
  );
}

/**
 * Hook to access the ApiService from context
 * @throws Error if used outside of ApiServiceProvider
 */
export function useApiService(): ApiServiceContextValue {
  const context = useContext(ApiServiceContext);

  if (!context) {
    throw new Error(
      "useApiService must be used within an ApiServiceProvider. " +
        "Wrap your component tree with <ApiServiceProvider>.",
    );
  }

  return context;
}

/**
 * Hook to get just the ApiService instance (for backwards compatibility)
 * @throws Error if used outside of ApiServiceProvider
 */
export function useApiServiceInstance(): ApiService {
  const { apiService } = useApiService();
  return apiService;
}
