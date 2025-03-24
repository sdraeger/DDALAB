"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import logger from "@/lib/utils/logger";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isLoggedIn = !!session;
  const loading = status === "loading";

  useEffect(() => {
    if (!loading && isLoggedIn) {
      router.push("/dashboard");
    }
  }, [isLoggedIn, loading, router]);

  logger.info("Rendering LoginPage from /app/api/auth/signin/page.tsx");
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center p-4 md:p-8">
      <LoginForm />
    </main>
  );
}
