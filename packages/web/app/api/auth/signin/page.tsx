"use client";

import { useRouter } from "next/navigation";
import { LoginForm } from "shared/components/form/LoginForm";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isLoggedIn = !!session;
  const loading = status === "loading";

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (isLoggedIn) {
    router.push("/dashboard");
    return null;
  }

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center p-4 md:p-8">
      <LoginForm />
    </main>
  );
}
