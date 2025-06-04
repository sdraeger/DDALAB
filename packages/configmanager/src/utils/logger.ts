export const logger = {
  info: (message: string, ...args: any[]) =>
    console.log(`[main.ts] ${message}`, ...args),
  warn: (message: string, ...args: any[]) =>
    console.warn(`[main.ts] ${message}`, ...args),
  error: (message: string, ...args: any[]) =>
    console.error(`[main.ts] ${message}`, ...args),
};
