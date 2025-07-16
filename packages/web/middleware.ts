import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import logger from "shared/lib/utils/logger";

// Cache auth mode to avoid repeated API calls
let authModeCache: {
  mode: string;
  timestamp: number;
  is_local_mode: boolean;
} | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
let retryCount = 0;

async function getAuthMode(): Promise<{
  is_local_mode: boolean;
  auth_mode: string;
}> {
  // Check cache first
  if (authModeCache && Date.now() - authModeCache.timestamp < CACHE_DURATION) {
    return {
      is_local_mode: authModeCache.is_local_mode,
      auth_mode: authModeCache.mode,
    };
  }

  try {
    // Check environment variable first as fallback for local mode
    const envAuthMode =
      process.env.DDALAB_AUTH_MODE ||
      process.env.DDALAB_AUTH_ENABLED === "False"
        ? "local"
        : "multi-user";

    // Reset retry count on successful cache hit or new attempt
    if (retryCount >= MAX_RETRIES) {
      logger.warn(
        `Max retries reached for auth mode check, using environment fallback: ${envAuthMode}`
      );
      const isLocal = envAuthMode === "local";
      return { is_local_mode: isLocal, auth_mode: envAuthMode };
    }

    // Get API URL - handle both development and production
    // Note: Middleware has different env loading, so we check multiple sources
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL === "http://api:8001"
        ? "http://localhost:8001" // Override docker URL with localhost for development
        : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

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
      is_local_mode: data.is_local_mode,
    };

    // Reset retry count on success
    retryCount = 0;

    return {
      is_local_mode: data.is_local_mode,
      auth_mode: data.auth_mode,
    };
  } catch (error) {
    retryCount++;
    logger.error(
      `Failed to check auth mode (attempt ${retryCount}/${MAX_RETRIES}):`,
      error
    );

    // Use environment variable as fallback
    const envAuthMode =
      process.env.DDALAB_AUTH_MODE ||
      (process.env.DDALAB_AUTH_ENABLED === "False" ? "local" : "multi-user");
    const isLocal = envAuthMode === "local";

    // If we've exceeded retries, use environment fallback
    if (retryCount >= MAX_RETRIES) {
      logger.warn(
        `Using environment fallback after max retries: ${envAuthMode}`
      );
      return { is_local_mode: isLocal, auth_mode: envAuthMode };
    }

    // For early failures, also use environment fallback but allow retry
    logger.info(`Using environment fallback for now: ${envAuthMode}`);
    return { is_local_mode: isLocal, auth_mode: envAuthMode };
  }
}

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
  // Get the pathname of the request
  const path = request.nextUrl.pathname;

  // Skip middleware for static files, Next.js internal routes, and specific NextAuth routes
  if (
    path.startsWith("/_next") ||
    path.startsWith("/static") ||
    path.includes(".") ||
    path === "/favicon.ico" ||
    path.startsWith("/api/auth/signin") || // NextAuth.js specific routes
    path.startsWith("/api/auth/signout") ||
    path.startsWith("/api/auth/session") ||
    path.startsWith("/api/auth/csrf") ||
    path.startsWith("/api/auth/providers") ||
    path.startsWith("/api/auth/callback")
  ) {
    return NextResponse.next();
  }

  // Check authentication mode
  const authMode = await getAuthMode();

  if (authMode.is_local_mode) {
    logger.info(`Middleware: Local mode detected, bypassing auth for ${path}`);
    return NextResponse.next();
  }

  // Multi-user mode - check authentication for protected API endpoints
  if (
    path.startsWith("/api/tickets") ||
    path.startsWith("/api/data") ||
    path.startsWith("/api/analysis") ||
    path.startsWith("/api/dda") ||
    path.startsWith("/api/modern-widget-layouts")
  ) {
    // Check for the auth token in the request headers
    const authHeader = request.headers.get("authorization");
    logger.info(
      `Middleware: Checking authentication for ${path} (multi-user mode)`
    );

    // No auth header or invalid format
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.info(`Middleware: Missing or invalid auth header for ${path}`);
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "Authentication required. Please log in.",
          path,
        },
        { status: 401 }
      );
    }

    // Extract the token
    const token = authHeader.split(" ")[1];

    // Empty token
    if (!token || token.trim() === "") {
      logger.info(`Middleware: Empty token for ${path}`);
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "Invalid authentication token. Please log in again.",
          path,
        },
        { status: 401 }
      );
    }

    // Token exists, proceed with the request
    logger.info(`Middleware: Valid auth token found for ${path}`);
  }

  return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    "/api/tickets/:path*",
    "/api/data/:path*",
    "/api/analysis/:path*",
    "/api/dda/:path*",
    "/api/modern-widget-layouts/:path*",
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
