"use client";

import type React from "react";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useUnifiedSession } from "../../hooks/useUnifiedSession";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, status } = useUnifiedSession();
  const router = useRouter();
  const pathname = usePathname();
  const loading = status === "loading";
  const isLoggedIn = !!user;

  useEffect(() => {
    // Only redirect if we're not already on the login page and the session check is complete
    if (!loading && !isLoggedIn && pathname !== "/login") {
      router.replace("/login");
    }
  }, [isLoggedIn, loading, router, pathname]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  return <>{children}</>;
}
