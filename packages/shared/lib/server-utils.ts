import https from "https";
import fs from "fs";
import { getEnvVar } from "./utils/env";

// Create an HTTPS agent that accepts self-signed certificates
export function createHttpsAgent() {
  const caPath = getEnvVar("API_SSL_CERT_PATH");
  if (!caPath) {
    throw new Error("API_SSL_CERT_PATH environment variable is required");
  }

  const ca = fs.readFileSync(caPath); // API server's self-signed cert or its CA
  console.log("Using CA from:", caPath);

  const httpsAgent = new https.Agent({
    ca, // Trust the API server's certificate
  });
  return httpsAgent;
}
