"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "shared/components/ui/button";
import { Card, CardContent } from "shared/components/ui/card";
import { ArtifactCard } from "shared/components/ui/ArtifactCard";
import { useArtifacts } from "shared/hooks/useArtifacts";
import { Artifact } from "shared/store/slices/artifactsSlice";
import { useUnifiedSessionData } from "shared/hooks/useUnifiedSession";

export default function ArtifactsPage() {
  const { data: session, status } = useUnifiedSessionData();
  const router = useRouter();
  const { artifacts, loading, error, autoFetch, fetchArtifacts, clearArtifacts, enableAutoFetch } = useArtifacts();

  useEffect(() => {
    if (status === "authenticated" && session?.accessToken && autoFetch) {
      fetchArtifacts(session.accessToken);
    }
  }, [status, session, autoFetch, fetchArtifacts]);

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
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Artifacts</h1>
          <p className="text-muted-foreground">
            View and manage your DDA result artifacts
            {!autoFetch && <span className="text-orange-500 font-medium"> (Auto-load disabled)</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {!autoFetch && (
            <Button
              onClick={enableAutoFetch}
              variant="default"
              disabled={loading}
              aria-label="Re-enable auto-loading of artifacts"
            >
              Enable Auto-Load
            </Button>
          )}
          <Button
            onClick={clearArtifacts}
            variant="outline"
            disabled={loading}
            aria-label="Clear artifacts from memory"
          >
            Clear
          </Button>
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
    </>
  );
}
