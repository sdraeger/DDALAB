// Configuration for the application
// In a real app, you might want to use environment variables for sensitive information

export const config = {
  // API configuration
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_URL || "https://api.example.com",
    timeout: 10000, // 10 seconds
  },

  // Authentication configuration
  auth: {
    // Token storage key in localStorage
    tokenKey: "ddalab_auth_token",
    // User storage key in localStorage
    userKey: "ddalab_user",
    // Token expiration timestamp in localStorage
    tokenExpirationKey: "ddalab_token_expiration",
    // Auth endpoint
    endpoint: "/api/auth/token",
  },

  // Application configuration
  app: {
    name: "DDALAB",
    version: "1.0.0",
  },
};
