import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const { data } = await supabase.auth.getSession();

  const publicRoutes = [
    "/",
    "/login",
    "/auth/callback",
    "/config", // config endpoint for configmanager
  ];

  const isPublicRoute = publicRoutes.some((route) =>
    req.nextUrl.pathname.startsWith(route)
  );

  // Allow API routes to pass through without authentication
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return res;
  }

  // Allow static assets and _next folder to pass through without authentication
  if (
    req.nextUrl.pathname.startsWith("/_next/") ||
    req.nextUrl.pathname.includes(".")
  ) {
    return res;
  }

  // Redirect to login if not authenticated and trying to access a protected route
  if (!data.session && !isPublicRoute) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirectedFrom", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users from login page to dashboard
  if (data.session && req.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return res;
}

// Completely disable middleware for debugging
export const config = {
  matcher: [],
};
