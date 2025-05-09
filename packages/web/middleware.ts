import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import logger from "shared/lib/utils/logger";

// This function can be marked `async` if using `await` inside
export function middleware(request: NextRequest) {
  // Get the pathname of the request
  const path = request.nextUrl.pathname;

  // Check if we're calling an API endpoint that requires authentication
  if (
    path.startsWith("/api/tickets") ||
    path.startsWith("/api/data") ||
    path.startsWith("/api/analysis")
  ) {
    // Check for the auth token in the request headers
    const authHeader = request.headers.get("authorization");
    logger.info(`Middleware: Checking authentication for ${path}`);

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
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
