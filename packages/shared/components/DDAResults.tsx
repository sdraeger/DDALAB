"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { Share2 } from "lucide-react";
import { ShareArtifactDialog } from "./dialog/ShareArtifactDialog";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ArtifactIdentifier, type ArtifactInfo } from "./ui/ArtifactIdentifier";

interface DDAResultsProps {
  result: {
    artifact_id: string;
    file_path: string;
    Q: (number | null)[][];
    metadata?: string;
  };
  artifactInfo?: ArtifactInfo;
}

export const DDAResults = ({ result, artifactInfo }: DDAResultsProps) => {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  return (
    <>
      <Card>
        {/* Artifact Identification Header */}
        {artifactInfo && (
          <ArtifactIdentifier artifact={artifactInfo} variant="header" />
        )}

        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>DDA Results</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShareDialogOpen(true)}
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p>File: {result.file_path}</p>
          <p>Metadata: {result.metadata || "None"}</p>
        </CardContent>
      </Card>
      <ShareArtifactDialog
        open={shareDialogOpen}
        setOpen={setShareDialogOpen}
        artifactId={result.artifact_id}
      />
    </>
  );
};
