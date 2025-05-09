"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@apollo/client";
import {
  GET_DDA_TASK_STATUS,
  GET_DDA_TASK_RESULT,
} from "../lib/graphql/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Progress } from "./ui/progress";
import { Button } from "./ui/button";
import { toast } from "../hooks/use-toast";
import { Download, RefreshCw } from "lucide-react";

interface TaskStatusProps {
  taskId: string;
  onComplete?: (results: any) => void;
}

export function TaskStatus({ taskId, onComplete }: TaskStatusProps) {
  const [progress, setProgress] = useState(0);
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5 seconds

  const {
    loading: statusLoading,
    error: statusError,
    data: statusData,
    refetch: refetchStatus,
  } = useQuery(GET_DDA_TASK_STATUS, {
    variables: { taskId },
    pollInterval: refreshInterval,
    fetchPolicy: "network-only",
  });

  const {
    loading: resultLoading,
    error: resultError,
    data: resultData,
    refetch: refetchResult,
  } = useQuery(GET_DDA_TASK_RESULT, {
    variables: { taskId },
    skip:
      !statusData?.getTaskStatus?.status ||
      statusData?.getTaskStatus?.status !== "completed",
    fetchPolicy: "network-only",
  });

  // Update progress based on status
  useEffect(() => {
    console.log("[TaskStatus] Status data updated:", statusData?.getTaskStatus);

    if (!statusData?.getTaskStatus) {
      console.log("[TaskStatus] No status data available yet");
      return;
    }

    const currentStatus = statusData.getTaskStatus.status;
    console.log(
      `[TaskStatus] Current status: ${currentStatus}, info: ${
        statusData.getTaskStatus.info || "none"
      }`
    );

    if (currentStatus === "PENDING" || currentStatus === "pending") {
      // Task is pending - waiting to start
      console.log("[TaskStatus] Task is pending, setting progress to 10%");
      setProgress(10);
    } else if (
      currentStatus === "STARTED" ||
      currentStatus === "started" ||
      currentStatus === "PROGRESS" ||
      currentStatus === "progress" ||
      currentStatus === "processing"
    ) {
      // Task is in progress
      console.log("[TaskStatus] Task is in progress, simulating progress");
      setProgress((prev) => Math.min(prev + 5, 90));
    } else if (
      currentStatus === "SUCCESS" ||
      currentStatus === "success" ||
      currentStatus === "COMPLETED" ||
      currentStatus === "completed"
    ) {
      // Task is complete
      console.log("[TaskStatus] Task is complete, setting progress to 100%");
      setProgress(100);
      setRefreshInterval(0); // Stop polling

      // Notify completion
      toast({
        title: "DDA Task Completed",
        description: "Your analysis is ready to view",
      });

      // Fetch results if not already fetched
      console.log("[TaskStatus] Fetching results for completed task");
      refetchResult();

      // Call onComplete callback with results
      if (onComplete && resultData?.getDdaResult) {
        console.log("[TaskStatus] Calling onComplete with results");
        onComplete(resultData.getDdaResult);
      }
    } else if (
      currentStatus === "FAILURE" ||
      currentStatus === "failure" ||
      currentStatus === "FAILED" ||
      currentStatus === "failed"
    ) {
      // Task failed
      console.log("[TaskStatus] Task failed");
      setProgress(0);
      setRefreshInterval(0); // Stop polling

      toast({
        title: "DDA Task Failed",
        description: statusData.getTaskStatus.info || "Unknown error",
        variant: "destructive",
      });
    }
  }, [statusData, resultData, onComplete, refetchResult, toast]);

  // Manual refresh
  const handleRefresh = () => {
    refetchStatus();
    if (statusData?.getTaskStatus?.status === "completed") {
      refetchResult();
    }
  };

  // Download results
  const handleDownload = () => {
    if (!resultData?.getDdaResult) return;

    try {
      const dataStr = JSON.stringify(resultData.getDdaResult, null, 2);
      const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(
        dataStr
      )}`;

      const exportName = `dda-result-${taskId}.json`;

      const linkElement = document.createElement("a");
      linkElement.setAttribute("href", dataUri);
      linkElement.setAttribute("download", exportName);
      linkElement.click();

      toast({
        title: "Results Downloaded",
        description: `Saved as ${exportName}`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>DDA Task Status</CardTitle>
        <CardDescription>Task ID: {taskId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Status: </span>
            <span className="font-medium">
              {statusLoading
                ? "Checking..."
                : statusData?.getTaskStatus?.status || "Unknown"}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {statusError && (
          <div className="text-sm text-destructive">
            Error checking status: {statusError.message}
          </div>
        )}

        {resultError && (
          <div className="text-sm text-destructive">
            Error fetching results: {resultError.message}
          </div>
        )}

        {statusData?.getTaskStatus?.status === "completed" &&
          resultData?.getDdaResult && (
            <div className="border rounded-md p-4 bg-muted/50">
              <h3 className="text-sm font-medium mb-2">Results Summary</h3>
              <div className="text-sm space-y-1">
                <div>File: {resultData.getDdaResult.filePath}</div>
                <div>Status: {statusData.getTaskStatus.status}</div>
                {resultData.getDdaResult.Q && (
                  <div>
                    Matrix dimensions: {resultData.getDdaResult.Q.length} x{" "}
                    {resultData.getDdaResult.Q[0]?.length || 0}
                  </div>
                )}
              </div>
            </div>
          )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={statusLoading || resultLoading}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>

        {statusData?.getTaskStatus?.status === "completed" &&
          resultData?.getDdaResult && (
            <Button variant="default" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />
              Download Results
            </Button>
          )}
      </CardFooter>
    </Card>
  );
}
