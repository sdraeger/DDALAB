"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AnalysisPreviewWindow } from "@/components/AnalysisPreviewWindow";
import { DDAResult } from "@/types/api";
import { Loader2 } from "lucide-react";

function AnalysisPreviewContent() {
  const searchParams = useSearchParams();
  const analysisId = searchParams.get("analysisId");
  const [analysis, setAnalysis] = useState<DDAResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAnalysisData = async () => {
      if (!analysisId) {
        setError("No analysis ID provided");
        setLoading(false);
        return;
      }

      try {
        // Get analysis data from Tauri backend
        const { invoke } = await import("@tauri-apps/api/core");
        const windowLabel = `analysis-preview-${analysisId}`;

        const analysisData = await invoke<DDAResult>(
          "get_analysis_preview_data",
          {
            windowId: windowLabel,
          },
        );

        if (analysisData) {
          setAnalysis(analysisData);
        } else {
          setError("Analysis data not found");
        }
      } catch (error) {
        console.error("Failed to load analysis data:", error);
        setError("Failed to load analysis data");
      } finally {
        setLoading(false);
      }
    };

    loadAnalysisData();
  }, [analysisId]);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading analysis preview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-red-600 mb-2">Error</p>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">No analysis data available</p>
        </div>
      </div>
    );
  }

  return <AnalysisPreviewWindow analysis={analysis} />;
}

export default function AnalysisPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-full flex items-center justify-center bg-background">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading analysis preview...</p>
          </div>
        </div>
      }
    >
      <AnalysisPreviewContent />
    </Suspense>
  );
}
