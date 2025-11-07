"use client";

import { useAppStore } from "@/store/appStore";
import { useStreamingData, useActiveStreams } from "@/hooks/useStreamingData";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Pause,
  Square,
  Trash2,
  Activity,
  Database,
  Clock,
  TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface StreamControlPanelProps {
  streamId: string;
  showDetails?: boolean;
}

export function StreamControlPanel({
  streamId,
  showDetails = true,
}: StreamControlPanelProps) {
  const {
    session,
    stats,
    isRunning,
    isPaused,
    hasError,
    isConnecting,
    pauseStream,
    resumeStream,
    stopStream,
  } = useStreamingData(streamId);

  const removeStreamSession = useAppStore((state) => state.removeStreamSession);
  const clearStreamPlotData = useAppStore((state) => state.clearStreamPlotData);

  if (!session) {
    return null;
  }

  const handlePause = async () => {
    try {
      await pauseStream(streamId);
    } catch (err) {
      console.error("Failed to pause stream:", err);
    }
  };

  const handleResume = async () => {
    try {
      await resumeStream(streamId);
    } catch (err) {
      console.error("Failed to resume stream:", err);
    }
  };

  const handleStop = async () => {
    try {
      await stopStream(streamId);
    } catch (err) {
      console.error("Failed to stop stream:", err);
    }
  };

  const handleRemove = async () => {
    try {
      await stopStream(streamId);
      removeStreamSession(streamId);
    } catch (err) {
      console.error("Failed to remove stream:", err);
    }
  };

  const handleClear = () => {
    clearStreamPlotData(streamId);
  };

  // Get state badge
  const getStateBadge = () => {
    if (isConnecting) {
      return <Badge variant="secondary">Connecting...</Badge>;
    }
    if (isRunning) {
      return (
        <Badge variant="default" className="bg-green-500">
          Running
        </Badge>
      );
    }
    if (isPaused) {
      return <Badge variant="secondary">Paused</Badge>;
    }
    if (hasError) {
      return <Badge variant="destructive">Error</Badge>;
    }
    return <Badge variant="outline">Stopped</Badge>;
  };

  // Format source type display
  const getSourceDisplay = () => {
    const config = session.source_config;
    switch (config.type) {
      case "file":
        return `File: ${config.path.split("/").pop()}`;
      case "websocket":
        return `WebSocket: ${config.url}`;
      case "tcp":
        return `TCP: ${config.host}:${config.port}`;
      case "udp":
        return `UDP: ${config.bind_address}:${config.port}`;
      case "serial":
        return `Serial: ${config.port}`;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-medium">
              Stream {streamId.slice(0, 8)}...
            </CardTitle>
            <CardDescription className="text-sm">
              {getSourceDisplay()}
            </CardDescription>
          </div>
          {getStateBadge()}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Control Buttons */}
        <div className="flex gap-2">
          {isRunning && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePause}
              disabled={isConnecting}
            >
              <Pause className="h-3 w-3 mr-1" />
              Pause
            </Button>
          )}

          {isPaused && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleResume}
              disabled={isConnecting}
            >
              <Play className="h-3 w-3 mr-1" />
              Resume
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={handleStop}
            disabled={!isRunning && !isPaused}
          >
            <Square className="h-3 w-3 mr-1" />
            Stop
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleClear}
            disabled={!stats || stats.chunks_received === 0}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>

          <Button
            size="sm"
            variant="destructive"
            onClick={handleRemove}
            className="ml-auto"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Remove
          </Button>
        </div>

        {/* Statistics */}
        {showDetails && stats && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <div className="flex items-center text-muted-foreground">
                  <Activity className="h-3 w-3 mr-1" />
                  Chunks Received
                </div>
                <div className="font-medium">
                  {(stats.chunks_received ?? 0).toLocaleString()}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center text-muted-foreground">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Results Generated
                </div>
                <div className="font-medium">
                  {(stats.results_generated ?? 0).toLocaleString()}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center text-muted-foreground">
                  <Database className="h-3 w-3 mr-1" />
                  Total Samples
                </div>
                <div className="font-medium">
                  {(stats.total_samples_received ?? 0).toLocaleString()}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center text-muted-foreground">
                  <Clock className="h-3 w-3 mr-1" />
                  Uptime
                </div>
                <div className="font-medium">
                  {Math.floor((stats.uptime_seconds ?? 0) / 60)}m{" "}
                  {Math.floor((stats.uptime_seconds ?? 0) % 60)}s
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Avg processing: {(stats.avg_processing_time_ms ?? 0).toFixed(1)}ms
              per window
            </div>
          </>
        )}

        {/* Error Display */}
        {hasError && session.state.type === "Error" && (
          <>
            <Separator />
            <div className="text-sm text-destructive">
              Error: {session.state.data.message}
            </div>
          </>
        )}

        {/* Timestamps */}
        {showDetails && (
          <div className="text-xs text-muted-foreground">
            Created{" "}
            {formatDistanceToNow(new Date(session.created_at * 1000), {
              addSuffix: true,
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * List view of all active streams
 */
export function StreamControlList() {
  const { allSessions } = useActiveStreams();
  const updateStreamUI = useAppStore((state) => state.updateStreamUI);

  if (allSessions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">
            No active streaming sessions
          </p>
          <Button onClick={() => updateStreamUI({ isConfigDialogOpen: true })}>
            <Play className="h-4 w-4 mr-2" />
            Create Stream
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {allSessions.map((session) => (
        <StreamControlPanel key={session.id} streamId={session.id} />
      ))}
    </div>
  );
}
