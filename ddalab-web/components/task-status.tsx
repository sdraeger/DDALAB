"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@apollo/client"
import { GET_DDA_TASK_STATUS, GET_DDA_TASK_RESULT } from "@/lib/graphql/queries"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"
import { Download, RefreshCw } from "lucide-react"

interface TaskStatusProps {
  taskId: string
  onComplete?: (results: any) => void
}

export function TaskStatus({ taskId, onComplete }: TaskStatusProps) {
  const [progress, setProgress] = useState(0)
  const [refreshInterval, setRefreshInterval] = useState(5000) // 5 seconds

  const {
    loading: statusLoading,
    error: statusError,
    data: statusData,
    refetch: refetchStatus,
  } = useQuery(GET_DDA_TASK_STATUS, {
    variables: { taskId },
    pollInterval: refreshInterval,
    fetchPolicy: "network-only",
  })

  const {
    loading: resultLoading,
    error: resultError,
    data: resultData,
    refetch: refetchResult,
  } = useQuery(GET_DDA_TASK_RESULT, {
    variables: { taskId },
    skip: !statusData?.ddaTaskStatus?.status || statusData?.ddaTaskStatus?.status !== "completed",
    fetchPolicy: "network-only",
  })

  // Update progress based on status
  useEffect(() => {
    if (statusData?.ddaTaskStatus?.status === "processing") {
      // Simulate progress while processing
      setProgress((prev) => Math.min(prev + 5, 90))
    } else if (statusData?.ddaTaskStatus?.status === "completed") {
      setProgress(100)
      setRefreshInterval(0) // Stop polling

      // Notify completion
      toast({
        title: "DDA Task Completed",
        description: "Your analysis is ready to view",
      })

      // Fetch results if not already fetched
      refetchResult()

      // Call onComplete callback with results
      if (onComplete && resultData?.ddaTaskResult) {
        onComplete(resultData.ddaTaskResult)
      }
    }
  }, [statusData?.ddaTaskStatus?.status, resultData])

  // Manual refresh
  const handleRefresh = () => {
    refetchStatus()
    if (statusData?.ddaTaskStatus?.status === "completed") {
      refetchResult()
    }
  }

  // Download results
  const handleDownload = () => {
    if (!resultData?.ddaTaskResult) return

    try {
      const dataStr = JSON.stringify(resultData.ddaTaskResult, null, 2)
      const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`

      const exportName = `dda-result-${taskId}.json`

      const linkElement = document.createElement("a")
      linkElement.setAttribute("href", dataUri)
      linkElement.setAttribute("download", exportName)
      linkElement.click()

      toast({
        title: "Results Downloaded",
        description: `Saved as ${exportName}`,
      })
    } catch (error) {
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      })
    }
  }

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
              {statusLoading ? "Checking..." : statusData?.ddaTaskStatus?.status || "Unknown"}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {statusError && <div className="text-sm text-destructive">Error checking status: {statusError.message}</div>}

        {resultError && <div className="text-sm text-destructive">Error fetching results: {resultError.message}</div>}

        {statusData?.ddaTaskStatus?.status === "completed" && resultData?.ddaTaskResult && (
          <div className="border rounded-md p-4 bg-muted/50">
            <h3 className="text-sm font-medium mb-2">Results Summary</h3>
            <div className="text-sm space-y-1">
              <div>File: {resultData.ddaTaskResult.filePath}</div>
              <div>Channels: {Object.keys(resultData.ddaTaskResult.results || {}).length}</div>
              {resultData.ddaTaskResult.metadata && (
                <div>Metadata: {JSON.stringify(resultData.ddaTaskResult.metadata).substring(0, 100)}...</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={statusLoading || resultLoading}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>

        {statusData?.ddaTaskStatus?.status === "completed" && resultData?.ddaTaskResult && (
          <Button variant="default" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download Results
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

