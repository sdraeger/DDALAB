// Browser-compatible logger that doesn't use workers
const isBrowser = typeof window !== "undefined";

interface Logger {
  info: (message: string, data?: any) => void;
  warn: (message: string, data?: any) => void;
  error: (message: string, data?: any) => void;
  debug: (message: string, data?: any) => void;
}

let logger: Logger;

if (isBrowser) {
  // Browser-compatible logger
  logger = {
    info: (message: string, data?: any) => {
      console.log(`[INFO] ${message}`, data || "");
    },
    warn: (message: string, data?: any) => {
      console.warn(`[WARN] ${message}`, data || "");
    },
    error: (message: string, data?: any) => {
      console.error(`[ERROR] ${message}`, data || "");
    },
    debug: (message: string, data?: any) => {
      console.debug(`[DEBUG] ${message}`, data || "");
    },
  };
} else {
  // Server-side logger with pino (simplified to avoid workers)
  const pino = require("pino");

  const pinoConfig = {
    level: "info",
  };

  logger = pino(pinoConfig);
}

export default logger;
