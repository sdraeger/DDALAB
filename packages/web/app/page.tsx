"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "shared/components/ui/button";
import { BrainCircuit } from "lucide-react";
import { useEffect } from "react";
import { useUnifiedSessionData } from "shared/hooks";

export default function Home() {
  const { data: session, status } = useUnifiedSessionData();
  const router = useRouter();
  const isLoggedIn = !!session;
  const loading = status === "loading";

  useEffect(() => {
    if (isLoggedIn) {
      router.push("/dashboard");
    }
  }, [isLoggedIn, router]);

  if (loading) return null;

  if (isLoggedIn) {
    return null;
  }

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center p-4 md:p-8">
      <div className="container flex flex-col items-center justify-center gap-6 text-center max-w-3xl">
        <BrainCircuit className="h-16 w-16 text-primary" />
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          DDALAB
        </h1>
        <p className="text-lg text-muted-foreground max-w-[42rem]">
          Upload, visualize, and analyze EEG data in your browser. Our powerful
          visualization tools help you gain insights from your EEG recordings.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Button size="lg" asChild>
            <Link href="/login">Login to Dashboard</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link
              href="https://github.com/yourusername/eeg-viewer"
              target="_blank"
            >
              View on GitHub
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
