// Centralized environment configuration for web20
// Ensures a single source of truth for env values across the app

export type EnvConfig = {
  API_URL: string; // Public base (Next app origin)
  APP_NAME: string;
  APP_VERSION: string;
};

const env: EnvConfig = {
  // For proxy approach, point to Next's own origin (no CORS in browser)
  API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
  APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || "DDALAB",
  APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0",
};

export default env;

export function getPublicEnv(): EnvConfig {
  return env;
}
