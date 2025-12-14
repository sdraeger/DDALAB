/**
 * Debounce utility for limiting function execution frequency
 */

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, wait);
  };
}

/**
 * Creates a debounced state updater that manages timeouts by key.
 * Useful for state slices that need to debounce multiple different updates.
 */
const debouncedTimers = new Map<string, NodeJS.Timeout>();

export function debouncedUpdate(
  key: string,
  fn: () => void | Promise<void>,
  wait: number = 150,
): void {
  const existing = debouncedTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timeoutId = setTimeout(() => {
    debouncedTimers.delete(key);
    fn();
  }, wait);

  debouncedTimers.set(key, timeoutId);
}

/**
 * Cancel a specific debounced update by key.
 * Call this in component cleanup to prevent memory leaks.
 */
export function cancelDebouncedUpdate(key: string): void {
  const existing = debouncedTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    debouncedTimers.delete(key);
  }
}

/**
 * Cancel all debounced updates matching a key prefix.
 * Useful for cleaning up all timers for a component/feature.
 */
export function cancelDebouncedUpdatesWithPrefix(prefix: string): void {
  const keysToDelete: string[] = [];

  debouncedTimers.forEach((timeout, key) => {
    if (key.startsWith(prefix)) {
      clearTimeout(timeout);
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => debouncedTimers.delete(key));
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function throttled(...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= wait) {
      lastCall = now;
      func(...args);
    } else {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func(...args);
        timeoutId = null;
      }, wait - timeSinceLastCall);
    }
  };
}
