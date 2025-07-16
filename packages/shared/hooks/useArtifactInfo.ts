import { useState, useEffect } from "react";
import type { ArtifactInfo } from "../components/ui/ArtifactIdentifier";
import { apiRequest } from "../lib/utils/request";
import { useUnifiedSessionData } from "./useUnifiedSession";

export function useArtifactInfo(artifactId?: string) {
  const { data: session } = useUnifiedSessionData();
  const [artifactInfo, setArtifactInfo] = useState<ArtifactInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!session?.accessToken || !artifactId) {
      setArtifactInfo(null);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchArtifact = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await apiRequest({
          url: `/api/artifacts/${artifactId}`,
          method: "GET",
          token: session.accessToken,
          responseType: "response",
        });

        if (!response.ok) {
          throw new Error("Failed to fetch artifact");
        }

        const data: ArtifactInfo = await response.json();
        setArtifactInfo(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
      } finally {
        setLoading(false);
      }
    };

    fetchArtifact();
  }, [session?.accessToken, artifactId]);

  return {
    artifactInfo,
    loading,
    error,
  };
}

export function useArtifactFromFilePath(filePath?: string) {
  const { data: session } = useUnifiedSessionData();
  const [artifactInfo, setArtifactInfo] = useState<ArtifactInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.accessToken || !filePath) {
      setArtifactInfo(null);
      return;
    }

    const fetchArtifactByFilePath = async () => {
      setLoading(true);
      setError(null);

      try {
        // Check if this looks like an artifact path (contains dda_results/)
        const isLikelyArtifactPath =
          filePath.includes("dda_results/") || filePath.includes("result.json");

        if (process.env.NODE_ENV === "development") {
          console.log(
            `[ArtifactInfo] Checking filePath: ${filePath}, isLikelyArtifactPath: ${isLikelyArtifactPath}`
          );
        }

        // Fetch all artifacts and find the one with matching file path
        const response = await apiRequest({
          url: "/api/artifacts",
          method: "GET",
          token: session.accessToken,
          responseType: "response",
        });

        if (!response.ok) {
          throw new Error("Failed to fetch artifacts");
        }

        const artifacts: ArtifactInfo[] = await response.json();

        if (process.env.NODE_ENV === "development") {
          console.log(
            `[ArtifactInfo] Found ${artifacts.length} total artifacts`
          );
          console.log(
            `[ArtifactInfo] Artifact file paths:`,
            artifacts.map((a) => a.file_path)
          );
        }

        const matchingArtifact = artifacts.find(
          (artifact) => artifact.file_path === filePath
        );

        setArtifactInfo(matchingArtifact || null);

        if (process.env.NODE_ENV === "development") {
          console.log(`[ArtifactInfo] Matching artifact:`, matchingArtifact);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        if (process.env.NODE_ENV === "development") {
          console.error(`[ArtifactInfo] Error:`, err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchArtifactByFilePath();
  }, [session?.accessToken, filePath]);

  return {
    artifactInfo,
    loading,
    error,
  };
}
