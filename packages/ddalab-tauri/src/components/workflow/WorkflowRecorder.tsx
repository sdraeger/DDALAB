"use client";

import { useEffect, useState, useCallback } from "react";
import {
  useBufferInfo,
  useAutoRecordingStatus,
  useEnableAutoRecord,
  useDisableAutoRecord,
  useClearBuffer,
  useGenerateCodeFromBuffer,
  useExportFromBuffer,
} from "@/hooks/useWorkflowQueries";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Circle,
  Download,
  Trash2,
  Code2,
  Eye,
  HelpCircle,
  Clock,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "@/components/ui/toaster";
import { Textarea } from "@/components/ui/textarea";

export function WorkflowRecorder() {
  // React Query hooks for data fetching with automatic polling
  const { data: bufferInfo } = useBufferInfo({ refetchInterval: 2000 });
  const { data: isRecording = false } = useAutoRecordingStatus();

  // React Query mutations
  const enableAutoRecord = useEnableAutoRecord();
  const disableAutoRecord = useDisableAutoRecord();
  const clearBufferMutation = useClearBuffer();
  const generateCodeMutation = useGenerateCodeFromBuffer();
  const exportFromBufferMutation = useExportFromBuffer();

  // Local UI state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [previewCode, setPreviewCode] = useState("");
  const [exportConfig, setExportConfig] = useState({
    name: "",
    language: "python" as "python" | "julia" | "matlab" | "rust" | "r",
    timeWindow: "all" as "all" | "5min" | "15min" | "30min" | "60min",
    optimize: true,
  });

  const toggleRecording = useCallback(async () => {
    console.log(
      "[WORKFLOW-RECORDER] Toggle recording, current state:",
      isRecording,
    );
    try {
      if (isRecording) {
        console.log("[WORKFLOW-RECORDER] Disabling auto-record...");
        await disableAutoRecord.mutateAsync();
        console.log("[WORKFLOW-RECORDER] Auto-record disabled");
        toast.success("Workflow recording stopped");
      } else {
        console.log("[WORKFLOW-RECORDER] Enabling auto-record...");
        await enableAutoRecord.mutateAsync();
        console.log("[WORKFLOW-RECORDER] Auto-record enabled");
        toast.success("Workflow recording started");
      }
    } catch (error) {
      console.error("[WORKFLOW-RECORDER] Toggle recording failed:", error);
      toast.error(`Failed to toggle recording: ${error}`);
    }
  }, [isRecording, enableAutoRecord, disableAutoRecord]);

  const handleClearBuffer = async () => {
    try {
      await clearBufferMutation.mutateAsync();
      toast.success("Action buffer cleared");
      setShowClearConfirm(false);
    } catch (error) {
      toast.error(`Failed to clear buffer: ${error}`);
    }
  };

  const handlePreview = async () => {
    if (!exportConfig.name) {
      toast.error("Please enter a workflow name");
      return;
    }

    try {
      const minutes =
        exportConfig.timeWindow === "all"
          ? undefined
          : parseInt(exportConfig.timeWindow);

      const code = await generateCodeMutation.mutateAsync({
        language: exportConfig.language,
        workflowName: exportConfig.name,
        lastNMinutes: minutes,
        optimize: exportConfig.optimize,
      });

      setPreviewCode(code);
      setShowPreviewDialog(true);
    } catch (error) {
      toast.error(`Failed to generate preview: ${error}`);
    }
  };

  const handleExport = async (format: "json" | "code") => {
    if (!exportConfig.name) {
      toast.error("Please enter a workflow name");
      return;
    }

    try {
      const minutes =
        exportConfig.timeWindow === "all"
          ? undefined
          : parseInt(exportConfig.timeWindow.replace("min", ""));

      let content: string;
      let extension: string;

      if (format === "json") {
        content = await exportFromBufferMutation.mutateAsync({
          workflowName: exportConfig.name,
          lastNMinutes: minutes,
        });
        extension = "json";
      } else {
        content = await generateCodeMutation.mutateAsync({
          language: exportConfig.language,
          workflowName: exportConfig.name,
          lastNMinutes: minutes,
          optimize: exportConfig.optimize,
        });
        const extensionMap = {
          python: "py",
          julia: "jl",
          matlab: "m",
          rust: "rs",
          r: "R",
        };
        extension = extensionMap[exportConfig.language];
      }

      const languageNames = {
        python: "Python Script",
        julia: "Julia Script",
        matlab: "MATLAB Script",
        rust: "Rust Source",
        r: "R Script",
      };

      const filePath = await save({
        defaultPath: `${exportConfig.name}.${extension}`,
        filters: [
          {
            name:
              format === "json"
                ? "Workflow JSON"
                : languageNames[exportConfig.language],
            extensions: [extension],
          },
        ],
      });

      if (filePath) {
        await writeTextFile(filePath, content);
        toast.success(`Workflow exported to ${filePath}`);
        setShowExportDialog(false);
      }
    } catch (error) {
      toast.error(`Failed to export workflow: ${error}`);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + R: Toggle recording
      if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
        toggleRecording();
      }
      // Ctrl/Cmd + E: Open export dialog
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        if (bufferInfo && bufferInfo.current_size > 0) {
          setShowExportDialog(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bufferInfo, toggleRecording]);

  // Derived state
  const isGeneratingPreview = generateCodeMutation.isPending;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2 rounded-lg border bg-card p-2 text-card-foreground shadow-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isRecording ? "destructive" : "default"}
              size="sm"
              onClick={toggleRecording}
              className="gap-2"
            >
              <Circle
                className={`h-3 w-3 ${isRecording ? "fill-current animate-pulse" : ""}`}
              />
              {isRecording ? "Recording" : "Start Recording"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {isRecording
                ? "Stop recording workflow actions"
                : "Start recording all DDA analysis actions"}
            </p>
          </TooltipContent>
        </Tooltip>

        {bufferInfo && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="font-medium">{bufferInfo.current_size}</span>
              <span>/ 200 actions</span>
            </div>
            {bufferInfo.total_recorded > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <HelpCircle className="h-3 w-3" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Total actions recorded: {bufferInfo.total_recorded}
                    <br />
                    Buffer holds last 200 actions
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="space-y-2">
                <p className="font-semibold">Keyboard Shortcuts</p>
                <div className="space-y-1 text-xs">
                  <p>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded">
                      Ctrl/Cmd+R
                    </kbd>{" "}
                    - Toggle recording
                  </p>
                  <p>
                    <kbd className="px-1.5 py-0.5 bg-muted rounded">
                      Ctrl/Cmd+E
                    </kbd>{" "}
                    - Export workflow
                  </p>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setShowExportDialog(true)}
                disabled={!bufferInfo || bufferInfo.current_size === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export Workflow
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowClearConfirm(true)}
                disabled={!bufferInfo || bufferInfo.current_size === 0}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Clear Buffer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Export Workflow</DialogTitle>
            <DialogDescription>
              Export your recorded workflow as executable code or JSON workflow
              definition.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="workflow-name">Workflow Name</Label>
              <Input
                id="workflow-name"
                placeholder="my_analysis_workflow"
                value={exportConfig.name}
                onChange={(e) =>
                  setExportConfig({ ...exportConfig, name: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">Code Language</Label>
              <Select
                value={exportConfig.language}
                onValueChange={(
                  value: "python" | "julia" | "matlab" | "rust" | "r",
                ) => setExportConfig({ ...exportConfig, language: value })}
              >
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="python">Python</SelectItem>
                  <SelectItem value="julia">Julia</SelectItem>
                  <SelectItem value="matlab">MATLAB</SelectItem>
                  <SelectItem value="rust">Rust</SelectItem>
                  <SelectItem value="r">R</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="time-window">Time Window</Label>
              <Select
                value={exportConfig.timeWindow}
                onValueChange={(
                  value: "all" | "5min" | "15min" | "30min" | "60min",
                ) => setExportConfig({ ...exportConfig, timeWindow: value })}
              >
                <SelectTrigger id="time-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="5min">Last 5 minutes</SelectItem>
                  <SelectItem value="15min">Last 15 minutes</SelectItem>
                  <SelectItem value="30min">Last 30 minutes</SelectItem>
                  <SelectItem value="60min">Last 60 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="optimize"
                checked={exportConfig.optimize}
                onChange={(e) =>
                  setExportConfig({
                    ...exportConfig,
                    optimize: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="optimize" className="font-normal cursor-pointer">
                Optimize code (coalesce parameters, simplify channel selection)
              </Label>
            </div>

            {bufferInfo && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="text-muted-foreground">
                  Buffer contains {bufferInfo.current_size} actions (
                  {bufferInfo.total_recorded} total recorded this session)
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={isGeneratingPreview}
              className="gap-2"
            >
              <Eye className="h-4 w-4" />
              {isGeneratingPreview ? "Generating..." : "Preview Code"}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleExport("json")}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Export JSON
              </Button>
              <Button onClick={() => handleExport("code")} className="gap-2">
                <Code2 className="h-4 w-4" />
                Export Code
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Code Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              Code Preview - {exportConfig.language.toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              Preview of generated {exportConfig.language} code for workflow
              &quot;{exportConfig.name}&quot;
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Textarea
              readOnly
              value={previewCode}
              className="font-mono text-xs min-h-[400px] max-h-[60vh] resize-none"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPreviewDialog(false)}
            >
              Close
            </Button>
            <Button onClick={() => handleExport("code")} className="gap-2">
              <Download className="h-4 w-4" />
              Export This Code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Buffer Confirmation Dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Action Buffer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {bufferInfo?.current_size || 0}{" "}
              recorded actions from the buffer. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearBuffer}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear Buffer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
