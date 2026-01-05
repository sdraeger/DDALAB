"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  AlertTriangle,
  Check,
  Copy,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "@/components/ui/toaster";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const BUFFER_CAPACITY = 200;
const BUFFER_WARNING_THRESHOLD = 180; // Warn at 90% capacity

export function WorkflowRecorder() {
  // React Query hooks for data fetching with automatic polling
  const { data: bufferInfo, isLoading: isLoadingBuffer } = useBufferInfo();
  const { data: isRecording = false, isLoading: isLoadingStatus } =
    useAutoRecordingStatus();

  // Track if we've shown the capacity warning
  const hasShownCapacityWarning = useRef(false);

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
  const [previewCodes, setPreviewCodes] = useState<Record<string, string>>({});
  const [previewLanguage, setPreviewLanguage] = useState<string>("python");
  const [copied, setCopied] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [exportConfig, setExportConfig] = useState({
    name: "",
    languages: ["python"] as ("python" | "julia" | "matlab" | "rust" | "r")[],
    timeWindow: "all" as "all" | "5min" | "15min" | "30min" | "60min",
    optimize: true,
  });

  // Buffer capacity warning effect
  useEffect(() => {
    if (!bufferInfo || !isRecording) return;

    const currentSize = bufferInfo.current_size;

    // Show warning when approaching capacity
    if (
      currentSize >= BUFFER_WARNING_THRESHOLD &&
      !hasShownCapacityWarning.current
    ) {
      toast.warning(
        "Buffer nearly full",
        `Recording buffer is at ${currentSize}/${BUFFER_CAPACITY}. Oldest actions will be removed.`,
      );
      hasShownCapacityWarning.current = true;
    }

    // Reset warning flag when buffer drops below threshold
    if (currentSize < BUFFER_WARNING_THRESHOLD - 20) {
      hasShownCapacityWarning.current = false;
    }
  }, [bufferInfo, isRecording]);

  const toggleRecording = useCallback(async () => {
    try {
      if (isRecording) {
        await disableAutoRecord.mutateAsync();
        toast.success(
          "Recording stopped",
          bufferInfo
            ? `${bufferInfo.current_size} actions captured`
            : undefined,
        );
      } else {
        await enableAutoRecord.mutateAsync();
        toast.success(
          "Recording started",
          "Your DDA analysis actions will be recorded",
        );
        hasShownCapacityWarning.current = false;
      }
    } catch (error) {
      console.error("Toggle recording failed:", error);
      toast.error("Failed to toggle recording", String(error));
    }
  }, [isRecording, enableAutoRecord, disableAutoRecord, bufferInfo]);

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
    if (exportConfig.languages.length === 0) {
      toast.error("Please select at least one language");
      return;
    }

    try {
      const minutes =
        exportConfig.timeWindow === "all"
          ? undefined
          : parseInt(exportConfig.timeWindow);

      // Use a default name if not provided
      const workflowName = exportConfig.name.trim() || "untitled_workflow";

      // Generate code for all selected languages
      const codes: Record<string, string> = {};
      for (const language of exportConfig.languages) {
        const code = await generateCodeMutation.mutateAsync({
          language,
          workflowName,
          lastNMinutes: minutes,
          optimize: exportConfig.optimize,
        });
        codes[language] = code;
      }

      setPreviewCodes(codes);
      setPreviewLanguage(exportConfig.languages[0]);
      setShowPreviewDialog(true);
    } catch (error) {
      toast.error(`Failed to generate preview: ${error}`);
    }
  };

  const handleExport = async (format: "json" | "code") => {
    if (!exportConfig.name.trim()) {
      setNameError(true);
      return;
    }
    if (format === "code" && exportConfig.languages.length === 0) {
      toast.error("Please select at least one language");
      return;
    }
    setNameError(false);

    try {
      const minutes =
        exportConfig.timeWindow === "all"
          ? undefined
          : parseInt(exportConfig.timeWindow.replace("min", ""));

      const extensionMap = {
        python: "py",
        julia: "jl",
        matlab: "m",
        rust: "rs",
        r: "R",
      };

      const languageNames = {
        python: "Python Script",
        julia: "Julia Script",
        matlab: "MATLAB Script",
        rust: "Rust Source",
        r: "R Script",
      };

      if (format === "json") {
        const content = await exportFromBufferMutation.mutateAsync({
          workflowName: exportConfig.name,
          lastNMinutes: minutes,
        });

        const filePath = await save({
          defaultPath: `${exportConfig.name}.json`,
          filters: [{ name: "Workflow JSON", extensions: ["json"] }],
        });

        if (filePath) {
          await writeTextFile(filePath, content);
          toast.success(`Workflow exported to ${filePath}`);
          setShowExportDialog(false);
        }
      } else {
        // Export each selected language
        let exportedCount = 0;
        for (const language of exportConfig.languages) {
          const content = await generateCodeMutation.mutateAsync({
            language,
            workflowName: exportConfig.name,
            lastNMinutes: minutes,
            optimize: exportConfig.optimize,
          });

          const extension = extensionMap[language];
          const filePath = await save({
            defaultPath: `${exportConfig.name}.${extension}`,
            filters: [
              { name: languageNames[language], extensions: [extension] },
            ],
          });

          if (filePath) {
            await writeTextFile(filePath, content);
            exportedCount++;
          }
        }

        if (exportedCount > 0) {
          toast.success(
            `Exported ${exportedCount} file${exportedCount > 1 ? "s" : ""}`,
          );
          setShowExportDialog(false);
        }
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
  const isTogglingRecording =
    enableAutoRecord.isPending || disableAutoRecord.isPending;
  const isExporting =
    exportFromBufferMutation.isPending || generateCodeMutation.isPending;
  const isClearingBuffer = clearBufferMutation.isPending;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5 rounded-md border bg-card/50 px-1.5 py-1 text-card-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isRecording ? "destructive" : "ghost"}
              size="sm"
              onClick={toggleRecording}
              disabled={isTogglingRecording || isLoadingStatus}
              className={cn(
                "gap-1.5 h-7 px-2 text-xs",
                !isRecording && "text-muted-foreground hover:text-foreground",
              )}
            >
              {isTogglingRecording ? (
                <Circle className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Circle
                  className={cn(
                    "h-2.5 w-2.5",
                    isRecording && "fill-current animate-pulse",
                  )}
                />
              )}
              {isTogglingRecording
                ? "..."
                : isRecording
                  ? "Recording"
                  : "Record"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {isRecording
                ? "Stop recording workflow actions (Ctrl/Cmd+R)"
                : "Start recording all DDA analysis actions (Ctrl/Cmd+R)"}
            </p>
          </TooltipContent>
        </Tooltip>

        {bufferInfo && bufferInfo.current_size > 0 && (
          <div className="flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center gap-0.5 text-[10px] px-1 rounded transition-colors duration-200",
                    bufferInfo.current_size >= BUFFER_CAPACITY
                      ? "text-destructive"
                      : bufferInfo.current_size >= BUFFER_WARNING_THRESHOLD
                        ? "text-yellow-600 dark:text-yellow-500"
                        : "text-muted-foreground",
                  )}
                >
                  {bufferInfo.current_size >= BUFFER_WARNING_THRESHOLD && (
                    <AlertTriangle className="h-2.5 w-2.5" />
                  )}
                  <span className="tabular-nums">
                    {bufferInfo.current_size}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  <p className="font-medium">Recording Buffer</p>
                  <p className="text-xs">
                    {bufferInfo.current_size} actions in buffer
                    {bufferInfo.total_recorded > bufferInfo.current_size && (
                      <>
                        <br />
                        {bufferInfo.total_recorded -
                          bufferInfo.current_size}{" "}
                        older actions removed
                      </>
                    )}
                  </p>
                  {bufferInfo.current_size >= BUFFER_WARNING_THRESHOLD && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-500">
                      Buffer nearly full - oldest actions will be removed
                    </p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-3 w-3" />
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
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                •••
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

      <Dialog
        open={showExportDialog}
        onOpenChange={(open) => {
          setShowExportDialog(open);
          if (!open) {
            setNameError(false);
          }
        }}
      >
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
                onChange={(e) => {
                  setExportConfig({ ...exportConfig, name: e.target.value });
                  if (nameError && e.target.value.trim()) {
                    setNameError(false);
                  }
                }}
                className={cn(
                  nameError &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
              {nameError && (
                <p className="text-sm text-destructive">
                  Please enter a workflow name
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Code Languages</Label>
              <div className="grid grid-cols-5 gap-1">
                {(
                  [
                    { value: "python", label: "Python" },
                    { value: "julia", label: "Julia" },
                    { value: "matlab", label: "MATLAB" },
                    { value: "rust", label: "Rust" },
                    { value: "r", label: "R" },
                  ] as const
                ).map((lang) => {
                  const isSelected = exportConfig.languages.includes(
                    lang.value,
                  );
                  return (
                    <Button
                      key={lang.value}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        const newLanguages = isSelected
                          ? exportConfig.languages.filter(
                              (l) => l !== lang.value,
                            )
                          : [...exportConfig.languages, lang.value];
                        setExportConfig({
                          ...exportConfig,
                          languages: newLanguages,
                        });
                      }}
                      className="justify-center gap-1 px-1 py-1.5"
                    >
                      {isSelected && <Check className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{lang.label}</span>
                    </Button>
                  );
                })}
              </div>
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
              className="h-auto gap-2 px-6 py-3.5"
            >
              <Eye className="h-4 w-4" />
              {isGeneratingPreview ? "Generating..." : "Preview Code"}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleExport("json")}
                className="h-auto gap-2 px-6 py-3.5"
              >
                <Download className="h-4 w-4" />
                Export JSON
              </Button>
              <Button
                onClick={() => handleExport("code")}
                className="h-auto gap-2 px-6 py-3.5"
              >
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
            <DialogTitle>Code Preview</DialogTitle>
            <DialogDescription>
              {exportConfig.name.trim()
                ? `Preview of generated code for workflow "${exportConfig.name.trim()}"`
                : "Preview of generated workflow code"}
            </DialogDescription>
          </DialogHeader>

          {/* Language tabs */}
          {Object.keys(previewCodes).length > 1 && (
            <div className="flex gap-1 border-b">
              {Object.keys(previewCodes).map((lang) => {
                const languageLabels: Record<string, string> = {
                  python: "Python",
                  julia: "Julia",
                  matlab: "MATLAB",
                  rust: "Rust",
                  r: "R",
                };
                return (
                  <button
                    key={lang}
                    onClick={() => setPreviewLanguage(lang)}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium transition-colors",
                      previewLanguage === lang
                        ? "border-b-2 border-primary text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {languageLabels[lang] ?? lang}
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative">
            <Textarea
              readOnly
              value={previewCodes[previewLanguage] ?? ""}
              className="font-mono text-xs min-h-[400px] max-h-[60vh] resize-none pr-12"
            />
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "absolute right-5 top-2 h-8 w-8 transition-colors duration-200",
                copied && "text-green-500 hover:text-green-500",
              )}
              onClick={async () => {
                const code = previewCodes[previewLanguage];
                if (code) {
                  await navigator.clipboard.writeText(code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              <div className="relative h-4 w-4">
                <Copy
                  className={cn(
                    "absolute inset-0 h-4 w-4 transition-all duration-200",
                    copied ? "scale-0 opacity-0" : "scale-100 opacity-100",
                  )}
                />
                <Check
                  className={cn(
                    "absolute inset-0 h-4 w-4 transition-all duration-200",
                    copied ? "scale-100 opacity-100" : "scale-0 opacity-0",
                  )}
                />
              </div>
              <span className="sr-only">
                {copied ? "Copied!" : "Copy code"}
              </span>
            </Button>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPreviewDialog(false)}
              className="h-auto px-6 py-3.5"
            >
              Close
            </Button>
            <Button
              onClick={() => handleExport("code")}
              className="h-auto gap-2 px-6 py-3.5"
            >
              <Download className="h-4 w-4" />
              Export Code
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
