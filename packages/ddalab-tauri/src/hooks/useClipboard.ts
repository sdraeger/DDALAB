/**
 * useClipboard - Custom hook for clipboard operations with proper cleanup
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { COPY_FEEDBACK_TIMEOUT_MS } from "@/components/collaboration/constants";

interface UseClipboardOptions {
  /** Duration to show "copied" state (default: 2000ms) */
  timeout?: number;
  /** Callback when copy fails */
  onError?: (error: Error) => void;
  /** Callback when copy succeeds */
  onSuccess?: () => void;
}

interface UseClipboardReturn {
  /** Whether content was recently copied */
  copied: boolean;
  /** The value that was copied (for multi-item tracking) */
  copiedValue: string | null;
  /** Copy text to clipboard */
  copy: (text: string) => Promise<boolean>;
  /** Reset copied state */
  reset: () => void;
}

/**
 * Hook for clipboard operations with automatic cleanup
 *
 * @example
 * ```tsx
 * const { copied, copy } = useClipboard({
 *   onError: (e) => toast.error("Failed to copy"),
 *   onSuccess: () => toast.success("Copied!")
 * });
 *
 * <Button onClick={() => copy(shareLink)}>
 *   {copied ? "Copied!" : "Copy"}
 * </Button>
 * ```
 */
export function useClipboard(
  options: UseClipboardOptions = {},
): UseClipboardReturn {
  const { timeout = COPY_FEEDBACK_TIMEOUT_MS, onError, onSuccess } = options;

  const [copied, setCopied] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const reset = useCallback(() => {
    setCopied(false);
    setCopiedValue(null);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setCopiedValue(text);
        onSuccess?.();

        // Auto-reset after timeout
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
          setCopiedValue(null);
        }, timeout);

        return true;
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("Failed to copy to clipboard");
        onError?.(err);
        return false;
      }
    },
    [timeout, onError, onSuccess],
  );

  return { copied, copiedValue, copy, reset };
}

/**
 * Hook for tracking multiple copied items (e.g., in a list)
 *
 * @example
 * ```tsx
 * const { isCopied, copy } = useMultiClipboard();
 *
 * {items.map(item => (
 *   <Button onClick={() => copy(item.id, item.link)}>
 *     {isCopied(item.id) ? "Copied!" : "Copy"}
 *   </Button>
 * ))}
 * ```
 */
export function useMultiClipboard(options: UseClipboardOptions = {}) {
  const { copied, copiedValue, copy: baseCopy, reset } = useClipboard(options);

  const copy = useCallback(
    async (id: string, text: string): Promise<boolean> => {
      // Store the ID in the copied value for tracking
      return baseCopy(`${id}::${text}`);
    },
    [baseCopy],
  );

  const isCopied = useCallback(
    (id: string): boolean => {
      return copied && copiedValue?.startsWith(`${id}::`) === true;
    },
    [copied, copiedValue],
  );

  return { isCopied, copy, reset };
}
