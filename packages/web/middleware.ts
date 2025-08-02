import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import logger from "shared/lib/utils/logger";

// Cache auth mode to avoid repeated API calls
let authModeCache: {
  mode: string;
  timestamp: number;
} | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
let retryCount = 0;

async function getAuthMode(): Promise<{
  auth_mode: string;
}> {
  // Check cache first
  if (authModeCache && Date.now() - authModeCache.timestamp < CACHE_DURATION) {
    return {
      auth_mode: authModeCache.mode,
    };
  }

  try {
    // Check environment variable first as fallback for local mode
    const envAuthMode = process.env.DDALAB_AUTH_MODE || "multi-user";

    // Reset retry count on successful cache hit or new attempt
    if (retryCount >= MAX_RETRIES) {
      logger.warn(
        `Max retries reached for auth mode check, using environment fallback: ${envAuthMode}`
      );
      return { auth_mode: envAuthMode };
    }

    // Get API URL - use the environment variable directly in Docker
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://api:8001";

    // Use a timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await fetch(`${apiUrl}/api/auth/mode`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Auth mode check failed: ${response.status}`);
    }

    const data = await response.json();

    // Update cache
    authModeCache = {
      mode: data.auth_mode,
      timestamp: Date.now(),
    };

    // Reset retry count on success
    retryCount = 0;

    return {
      auth_mode: data.auth_mode,
    };
  } catch (error) {
    retryCount++;
    logger.error(
      `Failed to check auth mode (attempt ${retryCount}/${MAX_RETRIES}):`,
      error
    );

    // Use environment variable as fallback
    const envAuthMode = process.env.DDALAB_AUTH_MODE || "multi-user";

    // If we've exceeded retries, use environment fallback
    if (retryCount >= MAX_RETRIES) {
      logger.warn(
        `Using environment fallback after max retries: ${envAuthMode}`
      );
      return { auth_mode: envAuthMode };
    }

    // For early failures, also use environment fallback but allow retry
    logger.info(`Using environment fallback for now: ${envAuthMode}`);
    return { auth_mode: envAuthMode };
  }
}

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
  // Temporarily disable middleware to get the application working
  console.log("[MIDDLEWARE] Temporarily disabled for debugging");
  return NextResponse.next();
}

// Completely disable middleware for debugging
export const config = {
  matcher: [],
};
