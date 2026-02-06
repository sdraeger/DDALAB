"use client";

import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import {
  useNewWorkflow,
  useClearWorkflow,
  useRecordAction,
  useGeneratePython,
  useGenerateJulia,
} from "@/hooks/useWorkflowQueries";
import { createLoadFileAction } from "@/types/workflow";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Circle,
  Square,
  Download,
  Trash2,
  FileCode,
  FileText,
  Clock,
  Activity,
} from "lucide-react";
import { toast } from "@/components/ui/toaster";

export function SessionRecorder() {
  const workflowRecording = useAppStore((state) => state.workflowRecording);
  const startWorkflowRecording = useAppStore(
    (state) => state.startWorkflowRecording,
  );
  const stopWorkflowRecording = useAppStore(
    (state) => state.stopWorkflowRecording,
  );
  const fileManager = useAppStore((state) => ({
    selectedFile: state.fileManager.selectedFile,
  }));
  const incrementActionCount = useAppStore(
    (state) => state.incrementActionCount,
  );

  // React Query mutations
  const newWorkflowMutation = useNewWorkflow();
  const clearWorkflowMutation = useClearWorkflow();
  const recordActionMutation = useRecordAction();
  const generatePythonMutation = useGeneratePython();
  const generateJuliaMutation = useGenerateJulia();

  // Derived loading state
  const isLoading =
    newWorkflowMutation.isPending ||
    clearWorkflowMutation.isPending ||
    recordActionMutation.isPending ||
    generatePythonMutation.isPending ||
    generateJuliaMutation.isPending;

  const [sessionName, setSessionName] = useState("");

  const handleStartRecording = async () => {
    const name = sessionName.trim() || undefined;

    // Generate session name before starting
    const actualSessionName =
      name || `session_${new Date().toISOString().split("T")[0]}_${Date.now()}`;

    // Start recording in store
    startWorkflowRecording(actualSessionName);

    // Initialize workflow in backend
    try {
      await newWorkflowMutation.mutateAsync(actualSessionName);
      console.log("[WORKFLOW] Workflow initialized:", actualSessionName);

      // If a file is already selected, record it as the first action
      if (fileManager.selectedFile) {
        console.log(
          "[WORKFLOW] Recording currently selected file:",
          fileManager.selectedFile.file_path,
        );

        // Determine file type from extension
        const ext = fileManager.selectedFile.file_path
          .split(".")
          .pop()
          ?.toLowerCase();
        let fileType: "EDF" | "ASCII" | "CSV" = "EDF";
        if (ext === "csv") fileType = "CSV";
        else if (ext === "ascii" || ext === "txt") fileType = "ASCII";

        const action = createLoadFileAction(
          fileManager.selectedFile.file_path,
          fileType,
        );
        await recordActionMutation.mutateAsync(action);
        incrementActionCount();
        console.log("[WORKFLOW] Recorded initial file load");
      }
    } catch (error) {
      console.error("Failed to initialize workflow:", error);
    }
  };

  const handleStopRecording = () => {
    stopWorkflowRecording();
  };

  const handleClearRecording = async () => {
    if (
      confirm(
        "Are you sure you want to clear the current recording? This cannot be undone.",
      )
    ) {
      try {
        await clearWorkflowMutation.mutateAsync();
        stopWorkflowRecording();
        setSessionName("");
      } catch (error) {
        console.error("Failed to clear recording:", error);
      }
    }
  };

  const handleExportPython = async () => {
    try {
      const code = await generatePythonMutation.mutateAsync();
      const blob = new Blob([code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workflowRecording.currentSessionName || "session"}.py`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export Python script:", error);
      toast.error(
        "Export Failed",
        "Failed to export Python script. See console for details.",
      );
    }
  };

  const handleExportJulia = async () => {
    try {
      const code = await generateJuliaMutation.mutateAsync();
      const blob = new Blob([code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workflowRecording.currentSessionName || "session"}.jl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export Julia script:", error);
      toast.error(
        "Export Failed",
        "Failed to export Julia script. See console for details.",
      );
    }
  };

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return "N/A";
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleString();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Session Recording
            </CardTitle>
            <CardDescription>
              Record your analysis workflow and export to Python or Julia
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {workflowRecording.isRecording && (
              <Badge variant="default" className="bg-red-600 hover:bg-red-700">
                <Circle className="h-3 w-3 mr-1 fill-white" />
                Recording
              </Badge>
            )}
            {!workflowRecording.isRecording &&
              workflowRecording.actionCount > 0 && (
                <Badge variant="outline">
                  <Square className="h-3 w-3 mr-1" />
                  Stopped
                </Badge>
              )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recording Controls */}
        {!workflowRecording.isRecording ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="session-name" className="text-sm">
                Session Name (optional)
              </Label>
              <Input
                id="session-name"
                placeholder="e.g., eeg_analysis_2024"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                disabled={isLoading}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave empty to auto-generate with timestamp
              </p>
            </div>
            <Button
              onClick={handleStartRecording}
              disabled={isLoading}
              className="w-full"
            >
              <Circle className="h-4 w-4 mr-2 fill-red-600 text-red-600" />
              Start Recording
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleStopRecording}
            variant="destructive"
            disabled={isLoading}
            className="w-full"
          >
            <Square className="h-4 w-4 mr-2" />
            Stop Recording
          </Button>
        )}

        <Separator />

        {/* Recording Status */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Session:</span>
            <span className="font-medium">
              {workflowRecording.currentSessionName || "No active session"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Actions recorded:</span>
            <Badge variant="secondary">{workflowRecording.actionCount}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last action:
            </span>
            <span className="text-xs">
              {formatTimestamp(workflowRecording.lastActionTimestamp)}
            </span>
          </div>
        </div>

        {/* Export Options */}
        {workflowRecording.actionCount > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label className="text-sm">Export as:</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleExportPython}
                  disabled={isLoading}
                  className="w-full"
                >
                  <FileCode className="h-4 w-4 mr-2" />
                  Python (.py)
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportJulia}
                  disabled={isLoading}
                  className="w-full"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Julia (.jl)
                </Button>
              </div>
            </div>

            <Button
              variant="ghost"
              onClick={handleClearRecording}
              disabled={isLoading || workflowRecording.isRecording}
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Recording
            </Button>
          </>
        )}

        {/* Info Text */}
        {workflowRecording.actionCount === 0 &&
          !workflowRecording.isRecording && (
            <div className="text-center text-sm text-muted-foreground p-4 bg-muted/50 rounded-md">
              Start recording to capture your analysis workflow. All file
              operations, parameter changes, and analysis runs will be recorded
              and can be exported as executable scripts.
            </div>
          )}
      </CardContent>
    </Card>
  );
}
