/**
 * Centralized error handling utility
 *
 * Provides consistent error handling patterns across the application:
 * - Toast notifications for user-facing errors
 * - Console logging for debugging
 * - Error categorization (critical, warning, silent)
 * - Retry logic for network operations
 */

import { toast } from "@/components/ui/toaster";

export type ErrorSeverity = "critical" | "warning" | "info" | "silent";

export interface ErrorContext {
  /** Where the error occurred */
  source: string;
  /** Additional context for debugging */
  details?: Record<string, unknown>;
  /** Error severity level */
  severity?: ErrorSeverity;
  /** Custom user-facing message (overrides default) */
  userMessage?: string;
  /** Whether to show a toast notification */
  showToast?: boolean;
}

/**
 * Extract a user-friendly message from various error types
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "An unexpected error occurred";
}

/**
 * Extract structured error data from API response
 */
export function extractApiError(error: unknown): {
  errorType?: string;
  message: string;
  details?: string;
} {
  // Check for Axios error with response data
  if (error && typeof error === "object") {
    // Handle both axios-style and fetch-style errors
    const axiosError = error as {
      response?: {
        data?: { error?: string; error_type?: string; details?: string };
        status?: number;
      };
      // Some wrappers use 'data' directly
      data?: { error?: string; error_type?: string; details?: string };
    };

    // Try axios structure first (error.response.data)
    if (axiosError.response?.data) {
      const data = axiosError.response.data;
      // Log for debugging API errors
      if (process.env.NODE_ENV === "development") {
        console.log("[ErrorHandler] Extracted API error:", {
          status: axiosError.response.status,
          errorType: data.error_type,
          message: data.error,
          details: data.details,
        });
      }
      return {
        errorType: data.error_type,
        message: data.error || extractErrorMessage(error),
        details: data.details,
      };
    }

    // Try direct data structure (some error wrappers)
    if (axiosError.data) {
      const data = axiosError.data;
      return {
        errorType: data.error_type,
        message: data.error || extractErrorMessage(error),
        details: data.details,
      };
    }
  }
  return { message: extractErrorMessage(error) };
}

/**
 * Check if an error is a git-annex "not downloaded" error
 */
export function isGitAnnexError(error: unknown): boolean {
  const { errorType, message } = extractApiError(error);
  const lowerMessage = message.toLowerCase();
  return (
    errorType === "git_annex_not_downloaded" ||
    lowerMessage.includes("git-annex") ||
    lowerMessage.includes("git annex") ||
    lowerMessage.includes("annex placeholder")
  );
}

/**
 * Get a user-friendly message based on error patterns
 */
function getUserFriendlyMessage(error: unknown, source: string): string {
  const { errorType, message, details } = extractApiError(error);
  const lowerMessage = message.toLowerCase();

  // Git-annex errors (file not downloaded)
  if (
    errorType === "git_annex_not_downloaded" ||
    lowerMessage.includes("git-annex") ||
    lowerMessage.includes("git annex")
  ) {
    return (
      details ||
      "This file hasn't been downloaded yet. Run 'git annex get <filename>' to download it."
    );
  }

  // Network errors
  if (
    lowerMessage.includes("network") ||
    lowerMessage.includes("fetch") ||
    lowerMessage.includes("connection")
  ) {
    return "Network connection issue. Please check your connection and try again.";
  }

  // Server errors
  if (
    lowerMessage.includes("500") ||
    lowerMessage.includes("server error") ||
    lowerMessage.includes("internal server")
  ) {
    return "Server error. Please try again in a moment.";
  }

  // File not found
  if (
    lowerMessage.includes("not found") ||
    lowerMessage.includes("404") ||
    lowerMessage.includes("no such file")
  ) {
    return "The requested file or resource was not found.";
  }

  // Permission errors
  if (
    lowerMessage.includes("permission") ||
    lowerMessage.includes("access denied") ||
    lowerMessage.includes("unauthorized")
  ) {
    return "Permission denied. Please check your access rights.";
  }

  // Timeout errors
  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
    return "Operation timed out. Please try again.";
  }

  // Parse errors
  if (
    lowerMessage.includes("parse") ||
    lowerMessage.includes("json") ||
    lowerMessage.includes("syntax")
  ) {
    return "Data format error. The file may be corrupted.";
  }

  // Return original if it's already user-friendly (short and no stack trace)
  if (message.length < 100 && !message.includes("\n")) {
    return message;
  }

  // Default fallback with source context
  return `Error in ${source}. Please try again or contact support if the issue persists.`;
}

/**
 * Main error handler function
 *
 * @example
 * // Silent logging (background operations)
 * handleError(error, { source: "backgroundSync", severity: "silent" });
 *
 * @example
 * // User-facing error with toast
 * handleError(error, { source: "FileUpload", severity: "critical" });
 *
 * @example
 * // Warning with custom message
 * handleError(error, {
 *   source: "DataValidation",
 *   severity: "warning",
 *   userMessage: "Some data could not be validated"
 * });
 */
export function handleError(error: unknown, context: ErrorContext): void {
  const {
    source,
    details,
    severity = "warning",
    userMessage,
    showToast = severity !== "silent",
  } = context;

  const errorMessage = extractErrorMessage(error);
  const friendlyMessage = userMessage || getUserFriendlyMessage(error, source);

  // Always log to console for debugging
  console.error(`[${source}] ${errorMessage}`, {
    severity,
    details,
    originalError: error,
  });

  // Show toast based on severity and showToast flag
  if (showToast) {
    switch (severity) {
      case "critical":
        toast.error(friendlyMessage, `Error in ${source}`);
        break;
      case "warning":
        toast.warning(friendlyMessage);
        break;
      case "info":
        toast.info(friendlyMessage);
        break;
      // silent: no toast
    }
  }
}

/**
 * Create a wrapped version of a promise that handles errors
 *
 * @example
 * // Instead of: somePromise.catch(console.error)
 * // Use: withErrorHandler(somePromise, { source: "MyOperation" })
 */
export async function withErrorHandler<T>(
  promise: Promise<T>,
  context: ErrorContext,
): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    handleError(error, context);
    return undefined;
  }
}

/**
 * Create a catch handler for promise chains
 *
 * @example
 * // Instead of: .catch(console.error)
 * // Use: .catch(createErrorCatcher("MyOperation"))
 */
export function createErrorCatcher(
  source: string,
  options: Omit<ErrorContext, "source"> = {},
): (error: unknown) => void {
  return (error: unknown) => {
    handleError(error, { source, ...options });
  };
}

/**
 * Create a silent error catcher (logs but no toast)
 * Use for background operations that shouldn't interrupt the user
 */
export function createSilentCatcher(source: string): (error: unknown) => void {
  return createErrorCatcher(source, { severity: "silent" });
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Base delay in milliseconds */
  baseDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Whether to use exponential backoff */
  exponentialBackoff?: boolean;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback when retry occurs */
  onRetry?: (attempt: number, error: unknown) => void;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  exponentialBackoff: true,
  isRetryable: (error: unknown) => {
    const message = extractErrorMessage(error).toLowerCase();
    // Retry on network errors, timeouts, and 5xx errors
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("fetch") ||
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504") ||
      message.includes("connection")
    );
  },
  onRetry: () => {},
};

/**
 * Execute a function with automatic retry on failure
 *
 * @example
 * const data = await withRetry(
 *   () => fetch('/api/data').then(r => r.json()),
 *   { maxRetries: 3 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const {
    maxRetries,
    baseDelay,
    maxDelay,
    exponentialBackoff,
    isRetryable,
    onRetry,
  } = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }

      // Calculate delay
      const delay = exponentialBackoff
        ? Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
        : baseDelay;

      // Notify about retry
      onRetry(attempt + 1, error);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Combine retry logic with error handling
 *
 * @example
 * const data = await withRetryAndErrorHandler(
 *   () => apiService.fetchData(),
 *   { source: "DataFetch", severity: "critical" },
 *   { maxRetries: 3 }
 * );
 */
export async function withRetryAndErrorHandler<T>(
  fn: () => Promise<T>,
  context: ErrorContext,
  retryConfig: RetryConfig = {},
): Promise<T | undefined> {
  try {
    return await withRetry(fn, {
      ...retryConfig,
      onRetry: (attempt, error) => {
        console.log(
          `[${context.source}] Retry attempt ${attempt}:`,
          extractErrorMessage(error),
        );
        retryConfig.onRetry?.(attempt, error);
      },
    });
  } catch (error) {
    handleError(error, context);
    return undefined;
  }
}

/**
 * Wrapper for async operations that should show loading state
 * and handle errors consistently
 */
export interface AsyncOperationResult<T> {
  data?: T;
  error?: string;
  success: boolean;
}

export async function executeAsync<T>(
  fn: () => Promise<T>,
  context: ErrorContext,
): Promise<AsyncOperationResult<T>> {
  try {
    const data = await fn();
    return { data, success: true };
  } catch (error) {
    handleError(error, context);
    return {
      error: extractErrorMessage(error),
      success: false,
    };
  }
}
