"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "../DashboardLayout";
import { Button } from "shared/components/ui/button";
import { Card, CardContent } from "shared/components/ui/card";
import { ArtifactCard } from "shared/components/ui/ArtifactCard";
import { useArtifacts } from "shared/hooks/useArtifacts";
import { useToast } from "shared/components/ui/use-toast";
import { Artifact } from "shared/store/slices/artifactsSlice";

export default function ArtifactsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const { artifacts, loading, error, fetchArtifacts } = useArtifacts();

  useEffect(() => {
    if (status === "authenticated" && session?.accessToken) {
      fetchArtifacts(session.accessToken);
    }
  }, [status, session, fetchArtifacts]);

  const handleRefresh = () => {
    if (session?.accessToken) {
      fetchArtifacts(session.accessToken);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Artifacts</h1>
          <p className="text-muted-foreground">
            View and manage your DDA result artifacts
          </p>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={loading}
          aria-label="Refresh artifacts"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {loading && artifacts.length === 0 ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-6">
            <div className="text-center text-destructive">
              <p>Failed to load artifacts. Please try again.</p>
              <p className="text-sm">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : artifacts.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center">
            <p>No artifacts found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {artifacts.map((artifact: Artifact) => (
            <ArtifactCard key={artifact.artifact_id} artifact={artifact} />
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
