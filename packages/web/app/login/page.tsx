"use client";

import { useRouter } from "next/navigation";
import { LoginForm } from "shared/components/form/LoginForm";
import { Loader2 } from "lucide-react";
import { useUnifiedSession } from "shared/hooks/useUnifiedSession";
import { useAuthMode } from "shared/contexts/AuthModeContext";
import { useEffect } from "react";

export default function LoginPage() {
  const { user, status } = useUnifiedSession();
  const { authMode } = useAuthMode();
  const router = useRouter();
  const isLoggedIn = !!user;
  const loading = status === "loading" || !authMode;

  useEffect(() => {
    // In local mode, redirect immediately to dashboard
    if (authMode === 'local') {
      router.replace("/dashboard");
      return;
    }

    // In multi-user mode, redirect if already logged in
    if (isLoggedIn && authMode === 'multi-user') {
      router.replace("/dashboard");
    }
  }, [isLoggedIn, authMode, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  // In local mode, show redirect message
  if (authMode === 'local') {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Local mode detected, redirecting to dashboard...</span>
      </div>
    );
  }

  // In multi-user mode, if already logged in, show redirect message
  if (isLoggedIn) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Redirecting...</span>
      </div>
    );
  }

  // In multi-user mode, not logged in - show login form
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center p-4 md:p-8">
      <LoginForm />
    </main>
  );
}
