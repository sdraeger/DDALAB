"use client";

import { useEffect, useState, useCallback, memo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
  Cloud,
  AlertTriangle,
  Copy,
  Check,
  Eye,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import {
  TauriService,
  type NSGJob,
  NSGJobStatus,
  NotificationType,
} from "@/services/tauriService";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useNSGCredentials,
  useNSGJobs,
  useUpdateNSGJobStatus,
  useDownloadNSGResults,
  useCancelNSGJob,
  useDeleteNSGJob,
  useCleanupPendingNSGJobs,
  useExtractNSGTarball,
  isExternalJob,
} from "@/hooks/useNSGJobs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSearchableItems, createActionItem } from "@/hooks/useSearchable";
import { toast } from "@/components/ui/toaster";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { debouncedUpdate, cancelDebouncedUpdate } from "@/utils/debounce";

function formatDateOrDash(dateStr: string | null): string {
  if (!dateStr) return "-";
  return formatDateTime(dateStr);
}

function getStatusIcon(status: NSGJobStatus) {
  switch (status) {
    case NSGJobStatus.Pending:
      return <Clock className="h-4 w-4 text-gray-500" />;
    case NSGJobStatus.Submitted:
    case NSGJobStatus.Queue:
      return <Play className="h-4 w-4 text-blue-500" />;
    case NSGJobStatus.InputStaging:
      return <Cloud className="h-4 w-4 text-blue-500" />;
    case NSGJobStatus.Running:
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case NSGJobStatus.Completed:
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case NSGJobStatus.Failed:
      return <XCircle className="h-4 w-4 text-red-500" />;
    case NSGJobStatus.Cancelled:
      return <AlertCircle className="h-4 w-4 text-orange-500" />;
    default:
      return <AlertCircle className="h-4 w-4" />;
  }
}

function getStatusBadge(status: NSGJobStatus) {
  const variants: Record<
    NSGJobStatus,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    [NSGJobStatus.Pending]: "outline",
    [NSGJobStatus.Submitted]: "secondary",
    [NSGJobStatus.Queue]: "secondary",
    [NSGJobStatus.InputStaging]: "secondary",
    [NSGJobStatus.Running]: "default",
    [NSGJobStatus.Completed]: "default",
    [NSGJobStatus.Failed]: "destructive",
    [NSGJobStatus.Cancelled]: "outline",
  };

  return (
    <Badge variant={variants[status]} className="flex items-center gap-1">
      {getStatusIcon(status)}
      <span>{status}</span>
    </Badge>
  );
}

function canCancel(job: NSGJob): boolean {
  return [
    NSGJobStatus.Submitted,
    NSGJobStatus.Queue,
    NSGJobStatus.Running,
  ].includes(job.status);
}

function canDownload(job: NSGJob): boolean {
  return job.status === NSGJobStatus.Completed && job.output_files.length > 0;
}

function canViewResults(job: NSGJob): boolean {
  return job.status === NSGJobStatus.Completed;
}

function canUpdateStatus(job: NSGJob): boolean {
  if (isExternalJob(job)) return false;
  return ![
    NSGJobStatus.Completed,
    NSGJobStatus.Failed,
    NSGJobStatus.Cancelled,
  ].includes(job.status);
}

interface NSGJobRowProps {
  job: NSGJob;
  copiedJobId: string | null;
  viewingJobId: string | null;
  downloadProgress: {
    jobId: string;
    currentFile: number;
    totalFiles: number;
    filename: string;
    bytesDownloaded: number;
    totalBytes: number;
    fileProgress: number;
  } | null;
  updateJobStatusPending: boolean;
  downloadResultsPending: boolean;
  cancelJobPending: boolean;
  deleteJobPending: boolean;
  onCopyJobId: (jobId: string, nsgJobId: string | null) => void;
  onUpdateStatus: (jobId: string) => void;
  onViewResults: (jobId: string) => void;
  onDownloadResults: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
}

const NSGJobRow = memo(function NSGJobRow({
  job,
  copiedJobId,
  viewingJobId,
  downloadProgress,
  updateJobStatusPending,
  downloadResultsPending,
  cancelJobPending,
  deleteJobPending,
  onCopyJobId,
  onUpdateStatus,
  onViewResults,
  onDownloadResults,
  onCancelJob,
  onDeleteJob,
}: NSGJobRowProps) {
  const isDownloading = viewingJobId === job.id;
  const showProgress = isDownloading && downloadProgress?.jobId === job.id;
  const isExternal = isExternalJob(job);
  const showViewButton = canViewResults(job);

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {isExternal ? (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                <Cloud className="h-3 w-3 mr-1" />
                External
              </Badge>
            ) : (
              <Badge variant="default" className="text-xs px-1.5 py-0">
                DDALAB
              </Badge>
            )}
            <span>{job.nsg_job_id || job.id.slice(0, 8)}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onCopyJobId(job.id, job.nsg_job_id)}
            title="Copy job ID"
          >
            {copiedJobId === job.id ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
      </TableCell>
      <TableCell>{getStatusBadge(job.status)}</TableCell>
      <TableCell>{job.tool}</TableCell>
      <TableCell className="text-sm">
        {formatDateOrDash(job.created_at)}
      </TableCell>
      <TableCell className="text-sm">
        {formatDateOrDash(job.submitted_at)}
      </TableCell>
      <TableCell className="text-sm">
        {formatDateOrDash(job.completed_at)}
      </TableCell>
      <TableCell className="text-sm">
        {showViewButton ? (
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onViewResults(job.id)}
              disabled={isDownloading}
              className="h-7"
              title={
                isExternal
                  ? "Download files (DDA results may not be available for external jobs)"
                  : "View DDA results"
              }
            >
              {isDownloading ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : isExternal ? (
                <Download className="h-3 w-3 mr-1" />
              ) : (
                <Eye className="h-3 w-3 mr-1" />
              )}
              {isExternal
                ? job.output_files.length > 0
                  ? `Download (${job.output_files.length})`
                  : "Download Files"
                : job.output_files.length > 0
                  ? `View (${job.output_files.length})`
                  : "View Results"}
            </Button>
            {showProgress && downloadProgress && (
              <div className="flex flex-col gap-1 min-w-[200px]">
                <div
                  className="text-xs text-muted-foreground truncate"
                  title={downloadProgress.filename}
                >
                  {downloadProgress.filename}
                </div>
                <div className="w-full bg-secondary rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress.fileProgress}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground flex justify-between">
                  <span>
                    File {downloadProgress.currentFile}/
                    {downloadProgress.totalFiles}
                  </span>
                  <span>{downloadProgress.fileProgress}%</span>
                </div>
                <div className="text-xs text-muted-foreground text-center">
                  {formatBytes(downloadProgress.bytesDownloaded)} /{" "}
                  {formatBytes(downloadProgress.totalBytes)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">
            {job.output_files.length > 0
              ? `${job.output_files.length} files`
              : "-"}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {canUpdateStatus(job) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdateStatus(job.id)}
              disabled={updateJobStatusPending}
              title="Update job status"
            >
              {updateJobStatusPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          )}
          {canDownload(job) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDownloadResults(job.id)}
              disabled={downloadResultsPending}
            >
              {downloadResultsPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}
          {canCancel(job) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCancelJob(job.id)}
              disabled={cancelJobPending}
            >
              {cancelJobPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDeleteJob(job.id)}
            disabled={deleteJobPending}
          >
            {deleteJobPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});

export const NSGJobManager = memo(function NSGJobManager() {
  // TanStack Query hooks
  const { data: hasCredentials = false } = useNSGCredentials();
  const {
    data: jobs = [],
    isLoading,
    error: jobsError,
    refetch: refetchJobs,
  } = useNSGJobs({ enabled: hasCredentials });
  const updateJobStatus = useUpdateNSGJobStatus();
  const downloadResults = useDownloadNSGResults();
  const cancelJob = useCancelNSGJob();
  const deleteJob = useDeleteNSGJob();
  const cleanupPendingJobs = useCleanupPendingNSGJobs();
  const extractTarball = useExtractNSGTarball();

  // Local UI state
  const [error, setError] = useState<string | null>(null);
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [successDialog, setSuccessDialog] = useState<{
    show: boolean;
    jobId: string;
    numChannels: number;
  } | null>(null);
  const [previousJobStatuses, setPreviousJobStatuses] = useState<
    Map<string, NSGJobStatus>
  >(new Map());
  const [downloadProgress, setDownloadProgress] = useState<{
    jobId: string;
    currentFile: number;
    totalFiles: number;
    filename: string;
    bytesDownloaded: number;
    totalBytes: number;
    fileProgress: number;
  } | null>(null);

  // Sort state with localStorage persistence
  type SortColumn =
    | "jobId"
    | "status"
    | "tool"
    | "created"
    | "submitted"
    | "completed";
  type SortDirection = "asc" | "desc";
  const [sortColumn, setSortColumn] = useState<SortColumn>(() => {
    try {
      const saved = localStorage.getItem("nsgJobManager_sortColumn");
      return (saved as SortColumn) || "created";
    } catch {
      return "created";
    }
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    try {
      const saved = localStorage.getItem("nsgJobManager_sortDirection");
      return (saved as SortDirection) || "desc";
    } catch {
      return "desc";
    }
  });

  // Register NSG jobs as searchable items
  useSearchableItems(
    [
      // Add each job as a searchable item
      ...jobs.map((job) =>
        createActionItem(
          `nsg-job-${job.id}`,
          `NSG Job: ${job.id.substring(0, 8)}...`,
          () => setViewingJobId(job.id),
          {
            subtitle: `Status: ${job.status}`,
            description: `${job.tool || "DDA"} job - ${job.status}`,
            keywords: [
              "nsg",
              "job",
              job.status.toLowerCase(),
              job.tool?.toLowerCase() || "dda",
              job.id,
            ],
            category: "NSG Jobs",
          },
        ),
      ),
      // Refresh jobs action
      createActionItem(
        "nsg-refresh-jobs",
        "Refresh NSG Jobs",
        () => refetchJobs(),
        {
          description: "Refresh the list of NSG jobs",
          keywords: ["refresh", "reload", "nsg", "jobs", "update"],
          category: "NSG Actions",
        },
      ),
    ],
    [jobs.length, jobs.map((j) => j.status).join(",")],
  );

  // Persist sort preferences with debouncing
  useEffect(() => {
    debouncedUpdate(
      "nsgJobManager_sortPreferences",
      () => {
        try {
          localStorage.setItem("nsgJobManager_sortColumn", sortColumn);
          localStorage.setItem("nsgJobManager_sortDirection", sortDirection);
        } catch {
          // Ignore localStorage errors (e.g., private browsing, quota exceeded)
        }
      },
      150, // Debounce for 150ms
    );
  }, [sortColumn, sortDirection]);

  // Cleanup debounced localStorage writes on unmount
  useEffect(() => {
    return () => {
      cancelDebouncedUpdate("nsgJobManager_sortPreferences");
    };
  }, []);

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // New column, default to descending for dates, ascending for others
      setSortColumn(column);
      setSortDirection(
        ["created", "submitted", "completed"].includes(column) ? "desc" : "asc",
      );
    }
  };

  // Track job status changes for notifications
  useEffect(() => {
    if (!jobs.length) return;

    const newStatuses = new Map<string, NSGJobStatus>();
    for (const job of jobs) {
      newStatuses.set(job.id, job.status);

      const previousStatus = previousJobStatuses.get(job.id);

      // Fire notification if job just completed
      if (
        previousStatus &&
        previousStatus !== NSGJobStatus.Completed &&
        job.status === NSGJobStatus.Completed
      ) {
        TauriService.createNotification(
          "NSG Job Completed",
          `Job ${job.id.substring(0, 8)}... has finished successfully. Results are ready to download.`,
          NotificationType.Success,
          "navigate_nsg_manager",
          { jobId: job.id },
        ).catch((error) => {
          console.error(
            "[NSG] Failed to create completion notification:",
            error,
          );
        });
      }

      // Fire notification if job failed
      if (
        previousStatus &&
        previousStatus !== NSGJobStatus.Failed &&
        job.status === NSGJobStatus.Failed
      ) {
        TauriService.createNotification(
          "NSG Job Failed",
          `Job ${job.id.substring(0, 8)}... has failed. Check the job details for more information.`,
          NotificationType.Error,
          "navigate_nsg_manager",
          { jobId: job.id },
        ).catch((error) => {
          console.error("[NSG] Failed to create failure notification:", error);
        });
      }
    }

    setPreviousJobStatuses(newStatuses);
  }, [jobs]);

  useEffect(() => {
    if (!TauriService.isTauri()) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("nsg-download-progress", (event: any) => {
          const payload = event.payload;
          setDownloadProgress({
            jobId: payload.job_id,
            currentFile: payload.current_file,
            totalFiles: payload.total_files,
            filename: payload.filename,
            bytesDownloaded: payload.bytes_downloaded,
            totalBytes: payload.total_bytes,
            fileProgress: payload.file_progress,
          });
        });
      } catch (error) {
        console.error("[NSG] Failed to setup progress listener:", error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleRefresh = async () => {
    setError(null);
    await refetchJobs();
  };

  const handleUpdateStatus = useCallback(
    async (jobId: string) => {
      try {
        setError(null);
        await updateJobStatus.mutateAsync(jobId);
      } catch (error) {
        console.error("[NSG] Failed to update job status:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        // If job hasn't been submitted yet, show a clearer message
        if (
          errorMsg.includes("has not been submitted yet") ||
          errorMsg.includes("Job not found")
        ) {
          setError(
            "Cannot update status: Job is still pending submission. Try deleting and re-submitting this job.",
          );
        } else {
          setError(`Failed to update job status: ${errorMsg}`);
        }
      }
    },
    [updateJobStatus],
  );

  const handleDownloadResults = useCallback(
    async (jobId: string) => {
      try {
        setError(null);
        const files = await downloadResults.mutateAsync(jobId);

        if (files.length > 0) {
          toast.success(
            "Download Complete",
            `Downloaded ${files.length} file${files.length > 1 ? "s" : ""}`,
          );
        } else {
          toast.warning("No Files", "No result files available");
        }
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to download results",
        );
      }
    },
    [downloadResults],
  );

  const handleCancelJob = useCallback(
    async (jobId: string) => {
      if (!confirm("Are you sure you want to cancel this job?")) return;

      try {
        setError(null);
        await cancelJob.mutateAsync(jobId);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to cancel job",
        );
      }
    },
    [cancelJob],
  );

  const handleDeleteJob = useCallback(
    async (jobId: string) => {
      if (
        !confirm(
          "Are you sure you want to delete this job? This will remove it from the database.",
        )
      )
        return;

      try {
        setError(null);
        await deleteJob.mutateAsync(jobId);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to delete job",
        );
      }
    },
    [deleteJob],
  );

  const handleCleanupPending = async () => {
    const pendingCount = jobs.filter(
      (j) => j.status === NSGJobStatus.Pending,
    ).length;
    if (pendingCount === 0) {
      toast.info("No Pending Jobs", "There are no pending jobs to clean up");
      return;
    }

    if (
      !confirm(
        `This will delete ${pendingCount} pending job(s) that failed to submit. Continue?`,
      )
    )
      return;

    try {
      setError(null);
      const deletedCount = await cleanupPendingJobs.mutateAsync();
      toast.success(
        "Cleanup Complete",
        `Cleaned up ${deletedCount} pending job(s)`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to cleanup pending jobs",
      );
    }
  };

  const handleCopyJobId = useCallback(
    async (jobId: string, nsgJobId: string | null) => {
      try {
        const idToCopy = nsgJobId || jobId;
        await navigator.clipboard.writeText(idToCopy);
        setCopiedJobId(jobId);

        // Reset the copied state after 2 seconds
        setTimeout(() => {
          setCopiedJobId(null);
        }, 2000);
      } catch (error) {
        console.error("Failed to copy job ID:", error);
        setError("Failed to copy job ID to clipboard");
      }
    },
    [],
  );

  const handleViewResults = useCallback(
    async (jobId: string) => {
      try {
        setViewingJobId(jobId);

        // Use mutation to download files - this also invalidates the jobs cache
        const files = await downloadResults.mutateAsync(jobId);

        if (files.length === 0) {
          toast.warning(
            "No Results Available",
            "This job may have failed or the results may have been cleaned up by NSG. If this is an old job, please submit a new one.",
          );
          return;
        }

        const tarFile = files.find((f) => f.includes("output.tar.gz"));
        if (tarFile) {
          try {
            const extractedFiles = await extractTarball.mutateAsync({
              jobId,
              tarFilePath: tarFile,
            });
            files.push(...extractedFiles);
          } catch {
            // Continue - files may already be extracted
          }
        }

        const resultsFile = files.find((f) => f.includes("dda_results.json"));

        if (!resultsFile) {
          const isExternalNonDDALAB = isExternalJob({ id: jobId } as NSGJob);

          if (isExternalNonDDALAB) {
            toast.info(
              "External Job",
              `This external job doesn't have DDALAB DDA results. Downloaded ${files.length} files to your local system.`,
              8000,
            );
          } else {
            toast.warning(
              "DDA Results Not Found",
              `Downloaded ${files.length} files but no DDA results found. The job may have failed - check STDERR for errors.`,
              8000,
            );
          }
          return;
        }

        try {
          const resultsJson = await TauriService.readTextFile(resultsFile);

          let resultsData;
          if (resultsJson.includes("NaN") || resultsJson.includes("Infinity")) {
            const sanitized = resultsJson
              .replace(/:\s*NaN\b/g, ": null")
              .replace(/:\s*Infinity\b/g, ": null")
              .replace(/:\s*-Infinity\b/g, ": null")
              .replace(/,\s*NaN\b/g, ", null")
              .replace(/,\s*Infinity\b/g, ", null")
              .replace(/,\s*-Infinity\b/g, ", null")
              .replace(/\[\s*NaN\b/g, "[null")
              .replace(/\[\s*Infinity\b/g, "[null")
              .replace(/\[\s*-Infinity\b/g, "[null");
            resultsData = JSON.parse(sanitized);
          } else {
            resultsData = JSON.parse(resultsJson);
          }

          const channelIndices = resultsData.parameters?.channels || [];
          const qMatrixArray = Array.isArray(resultsData.q_matrix)
            ? resultsData.q_matrix
            : Object.values(resultsData.q_matrix);

          // Convert 2D array to map format
          // IMPORTANT: Channel indices can be 0, which is falsy in JavaScript!
          // Use explicit undefined check instead of ||
          const ddaMatrix: Record<string, number[]> = {};
          const channels: string[] = [];

          // Use channel names from EDF if available, otherwise fall back to generic names
          const channelNamesFromEdf = resultsData.channel_names || [];

          qMatrixArray.forEach((channelData: number[], index: number) => {
            // Get channel index or use the iteration index as fallback
            const channelIndex =
              channelIndices[index] !== undefined
                ? channelIndices[index]
                : index;

            // Use actual channel name from EDF if available, otherwise use generic name
            const channelName =
              channelNamesFromEdf[index] || `Ch ${channelIndex + 1}`;

            ddaMatrix[channelName] = channelData;
            channels.push(channelName);
          });

          // Generate window indices array (actual time points, not just indices)
          const numTimepoints =
            resultsData.num_timepoints || qMatrixArray[0]?.length || 0;
          const windowIndices =
            resultsData.window_indices ||
            resultsData.scales ||
            Array.from({ length: numTimepoints }, (_, i) => i);

          // Transform NSG results to match DDA Results component expected format
          // DDAResults expects: result.results.variants to be an ARRAY of variant objects
          const transformedResults = {
            results: {
              variants: [
                // MUST be an array!
                {
                  variant_id: "single_timeseries",
                  variant_name: "NSG Results",
                  dda_matrix: ddaMatrix, // {channel: [values]}
                  exponents: resultsData.exponents || {},
                  quality_metrics: resultsData.quality_metrics || {},
                },
              ],
              window_indices: windowIndices, // Required: x-axis values for plots
              scales: windowIndices, // Deprecated, for backward compatibility
              Q: qMatrixArray, // Original 2D array format
              channels: channels,
              plot_data: qMatrixArray, // Original 2D array format
              dda_matrix: ddaMatrix, // Also add at top level for backward compatibility
              metadata: {
                input_file: resultsData.parameters?.input_file,
                time_range: resultsData.parameters?.time_range,
                window_parameters: {
                  window_length: resultsData.parameters?.window_length,
                  window_step: resultsData.parameters?.window_step,
                },
                scale_parameters: resultsData.parameters?.scale_parameters,
                num_channels: resultsData.num_channels,
                num_timepoints: numTimepoints,
              },
            },
            parameters: resultsData.parameters,
            channels: channels, // Top-level channels for metadata display
            name: `NSG Job ${jobId.slice(0, 8)}`,
            id: jobId,
            created_at: new Date().toISOString(),
            source: "nsg", // Mark as NSG source
          };

          // Load the results into the DDA analysis viewer
          // Dispatch event to DDA Analysis component to load these results
          window.dispatchEvent(
            new CustomEvent("load-nsg-results", {
              detail: {
                jobId,
                resultsFile,
                resultsData: transformedResults,
                sourceType: "nsg",
              },
            }),
          );

          // Show success dialog with option to navigate to Results tab
          setSuccessDialog({
            show: true,
            jobId: jobId.slice(0, 8),
            numChannels: resultsData.num_channels || 0,
          });
        } catch (parseError) {
          console.error("[NSG] Failed to parse results file:", parseError);
          toast.error(
            "Failed to Load Results",
            "The results file may be corrupted. Check the console for details.",
          );
          return;
        }
      } catch (error) {
        console.error("[NSG] Failed to view results:", error);
        const errorMsg =
          error instanceof Error ? error.message : "Failed to view results";

        // Show user-friendly error
        if (errorMsg.includes("No output files available")) {
          setError(
            "No output files available. This job may have failed or results were cleaned up. Please submit a new job.",
          );
        } else {
          setError(errorMsg);
        }
      } finally {
        setViewingJobId(null);
        setDownloadProgress(null);
      }
    },
    [downloadResults, extractTarball],
  );

  // Filter jobs based on search term across all fields
  const filteredJobs = jobs
    .filter((job) => {
      if (!searchTerm.trim()) return true;

      const search = searchTerm.toLowerCase();
      const jobId = (job.nsg_job_id || job.id || "").toLowerCase();
      const status = job.status.toLowerCase();
      const tool = job.tool.toLowerCase();
      const created = formatDateOrDash(job.created_at).toLowerCase();
      const submitted = formatDateOrDash(job.submitted_at).toLowerCase();
      const completed = formatDateOrDash(job.completed_at).toLowerCase();

      return (
        jobId.includes(search) ||
        status.includes(search) ||
        tool.includes(search) ||
        created.includes(search) ||
        submitted.includes(search) ||
        completed.includes(search)
      );
    })
    .sort((a, b) => {
      let aVal: string | number | null;
      let bVal: string | number | null;

      switch (sortColumn) {
        case "jobId":
          aVal = a.nsg_job_id || a.id || "";
          bVal = b.nsg_job_id || b.id || "";
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        case "tool":
          aVal = a.tool;
          bVal = b.tool;
          break;
        case "created":
          aVal = a.created_at ? new Date(a.created_at).getTime() : 0;
          bVal = b.created_at ? new Date(b.created_at).getTime() : 0;
          break;
        case "submitted":
          aVal = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
          bVal = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
          break;
        case "completed":
          aVal = a.completed_at ? new Date(a.completed_at).getTime() : 0;
          bVal = b.completed_at ? new Date(b.completed_at).getTime() : 0;
          break;
        default:
          return 0;
      }

      // Handle null/empty values - push to end
      if (!aVal && bVal) return 1;
      if (aVal && !bVal) return -1;
      if (!aVal && !bVal) return 0;

      // Compare values
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

  const handleNavigateToResults = () => {
    // Navigate to the main Dashboard Results tab, not the DDA Analysis tab
    window.dispatchEvent(new CustomEvent("navigate-to-main-results"));
    setSuccessDialog(null);
  };

  if (!TauriService.isTauri()) {
    return (
      <div className="p-6">
        <Alert>
          <AlertDescription>
            NSG job management is only available in the Tauri desktop
            application.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasCredentials) {
    return (
      <div className="p-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Please configure NSG credentials in Settings before managing jobs.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                NSG Job Manager
              </CardTitle>
              <CardDescription>
                View and manage your Neuroscience Gateway HPC jobs
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {jobs.some((j) => j.status === NSGJobStatus.Pending) && (
                <Button
                  onClick={handleCleanupPending}
                  variant="outline"
                  size="sm"
                  disabled={cleanupPendingJobs.isPending}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Clean Up Pending
                </Button>
              )}
              <Button
                onClick={handleRefresh}
                variant="outline"
                size="sm"
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(error || jobsError) && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error ||
                  (jobsError instanceof Error
                    ? jobsError.message
                    : "Failed to load jobs")}
              </AlertDescription>
            </Alert>
          )}

          {/* Search Bar */}
          {jobs.length > 0 && (
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search jobs by ID, status, tool, or date..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-input rounded-md bg-background text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear search"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {isLoading && jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2
                className="h-8 w-8 animate-spin mb-3"
                aria-hidden="true"
              />
              <p className="text-sm">Loading jobs...</p>
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Cloud
                className="h-12 w-12 mx-auto mb-4 opacity-50"
                aria-hidden="true"
              />
              <p className="font-medium text-foreground mb-2">No NSG Jobs</p>
              <p className="text-sm max-w-xs mx-auto">
                Submit a job from the DDA analysis panel to run analyses on the
                NSG cloud computing platform.
              </p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Search
                className="h-12 w-12 mx-auto mb-4 opacity-50"
                aria-hidden="true"
              />
              <p className="font-medium text-foreground mb-2">
                No Results Found
              </p>
              <p className="text-sm">
                No jobs match "<span className="font-medium">{searchTerm}</span>
                "
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchTerm("")}
                className="mt-4"
              >
                Clear Search
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        onClick={() => handleSort("jobId")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Job ID
                        {sortColumn === "jobId" ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("status")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Status
                        {sortColumn === "status" ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("tool")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Tool
                        {sortColumn === "tool" ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("created")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Created
                        {sortColumn === "created" ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("submitted")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Submitted
                        {sortColumn === "submitted" ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("completed")}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Completed
                        {sortColumn === "completed" ? (
                          sortDirection === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="h-4 w-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>Results</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <NSGJobRow
                      key={job.id}
                      job={job}
                      copiedJobId={copiedJobId}
                      viewingJobId={viewingJobId}
                      downloadProgress={downloadProgress}
                      updateJobStatusPending={updateJobStatus.isPending}
                      downloadResultsPending={downloadResults.isPending}
                      cancelJobPending={cancelJob.isPending}
                      deleteJobPending={deleteJob.isPending}
                      onCopyJobId={handleCopyJobId}
                      onUpdateStatus={handleUpdateStatus}
                      onViewResults={handleViewResults}
                      onDownloadResults={handleDownloadResults}
                      onCancelJob={handleCancelJob}
                      onDeleteJob={handleDeleteJob}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Success Dialog */}
      <AlertDialog
        open={successDialog?.show || false}
        onOpenChange={(open) => !open && setSuccessDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              NSG Results Loaded Successfully!
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-2">
                <div className="text-sm">
                  <strong>Job ID:</strong> {successDialog?.jobId}
                </div>
                <div className="text-sm">
                  <strong>Channels Analyzed:</strong>{" "}
                  {successDialog?.numChannels}
                </div>
                <div className="text-sm text-muted-foreground mt-4">
                  Your results have been loaded and are ready to view in the DDA
                  Analysis panel.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSuccessDialog(null)}>
              Close
            </AlertDialogAction>
            <Button onClick={handleNavigateToResults} className="ml-2">
              <Eye className="h-4 w-4 mr-2" />
              View Results
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
