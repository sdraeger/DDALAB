import type { Agent } from "https";

// This function will only be called on the server side
export const createHttpsAgent = async (): Promise<Agent | undefined> => {
  // Only import Node.js modules on the server
  if (typeof window === "undefined") {
    try {
      // Dynamically import Node.js modules
      const { readFileSync } = await import("fs");
      const https = await import("https");

      const keyPath = process.env.SSL_KEY_PATH;
      const certPath = process.env.SSL_CERT_PATH;

      if (!keyPath || !certPath) {
        console.warn("SSL certificate paths not provided");
        return undefined;
      }

      return new https.Agent({
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
        // Set to false if using self-signed certificates
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
      });
    } catch (error) {
      console.warn("Failed to create HTTPS agent:", error);
      return undefined;
    }
  }

  return undefined;
};
