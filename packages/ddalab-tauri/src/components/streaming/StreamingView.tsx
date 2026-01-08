"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useInitializeStreaming } from "@/services/streamingService";
import { useActiveStreams } from "@/hooks/useStreamingData";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Activity,
  TrendingUp,
  Settings,
  AlertCircle,
} from "lucide-react";
import { StreamConfigDialog } from "./StreamConfigDialog";
import { StreamControlList, StreamControlPanel } from "./StreamControlPanel";
import { StreamingPlot } from "./StreamingPlot";
import { StreamingHeatmap } from "./StreamingHeatmap";
import { StreamingDDALinePlot } from "./StreamingDDALinePlot";
import { StreamHistoryList } from "./StreamHistoryList";
import { useSearchableItems, createActionItem } from "@/hooks/useSearchable";

export function StreamingView() {
  const { isInitialized, error } = useInitializeStreaming();
  const { allSessions, runningCount, activeCount } = useActiveStreams();
  const updateStreamUI = useAppStore((state) => state.updateStreamUI);
  const selectedStreamId = useAppStore(
    (state) => state.streaming.ui.selectedStreamId,
  );
  const showHeatmap = useAppStore((state) => state.streaming.ui.showHeatmap);

  // Auto-select first running stream
  useEffect(() => {
    if (!selectedStreamId && allSessions.length > 0) {
      const firstRunning = allSessions.find((s) => s.state.type === "Running");
      if (firstRunning) {
        updateStreamUI({ selectedStreamId: firstRunning.id });
      }
    }
  }, [selectedStreamId, allSessions, updateStreamUI]);

  // Register searchable items for streaming
  useSearchableItems(
    [
      createActionItem(
        "streaming-new-session",
        "New Streaming Session",
        () => {
          document.getElementById("new-stream-button")?.click();
        },
        {
          description: "Start a new real-time streaming session",
          keywords: [
            "stream",
            "new",
            "session",
            "real-time",
            "live",
            "lsl",
            "zmq",
          ],
          category: "Streaming",
        },
      ),
      // Add active streams as searchable items
      ...allSessions
        .filter((s) => s.state.type === "Running")
        .map((session) =>
          createActionItem(
            `stream-${session.id}`,
            `Stream: ${session.source_config.type}`,
            () => updateStreamUI({ selectedStreamId: session.id }),
            {
              description: `Active ${session.source_config.type} streaming session`,
              keywords: [
                "stream",
                "active",
                "running",
                session.source_config.type.toLowerCase(),
              ],
              category: "Active Streams",
            },
          ),
        ),
    ],
    [allSessions.length, runningCount],
  );

  if (!isInitialized) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Activity className="h-8 w-8 animate-pulse text-muted-foreground mr-2" />
          <span className="text-muted-foreground">
            Initializing streaming service...
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to initialize streaming service: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Real-Time Streaming
          </h2>
          <p className="text-muted-foreground">
            Stream data from various sources and run continuous DDA analysis
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <Badge variant="outline">
              {allSessions.length}{" "}
              {allSessions.length === 1 ? "session" : "sessions"}
            </Badge>
            {runningCount > 0 && (
              <Badge variant="default" className="bg-green-500">
                {runningCount} running
              </Badge>
            )}
          </div>

          <Button onClick={() => updateStreamUI({ isConfigDialogOpen: true })}>
            <Play className="h-4 w-4 mr-2" />
            New Stream
          </Button>
        </div>
      </div>

      <Separator />

      {/* Main Content */}
      <Tabs defaultValue="sessions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sessions">
            <Settings className="h-4 w-4 mr-2" />
            Sessions
          </TabsTrigger>
          {/* Always render plot tabs - disabled when no stream selected */}
          <TabsTrigger value="plot" disabled={!selectedStreamId}>
            <Activity className="h-4 w-4 mr-2" />
            Time Series
          </TabsTrigger>
          <TabsTrigger value="dda-line" disabled={!selectedStreamId}>
            <TrendingUp className="h-4 w-4 mr-2" />
            DDA Line Plot
          </TabsTrigger>
          <TabsTrigger value="heatmap" disabled={!selectedStreamId}>
            <TrendingUp className="h-4 w-4 mr-2" />
            DDA Heatmap
          </TabsTrigger>
        </TabsList>

        {/* Sessions Tab */}
        <TabsContent value="sessions" className="space-y-4">
          {/* Recent Sources History */}
          <StreamHistoryList />

          {/* Active Sessions */}
          <Card>
            <CardHeader>
              <CardTitle>Active Streaming Sessions</CardTitle>
              <CardDescription>
                Manage your real-time data streams and DDA processing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StreamControlList />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Time Series Plot Tab - Always mounted, shows placeholder when no stream */}
        <TabsContent value="plot" className="space-y-4">
          {selectedStreamId ? (
            <StreamingPlot streamId={selectedStreamId} height={500} />
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
                Select a stream to view the time series plot
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DDA Line Plot Tab - Always mounted, shows placeholder when no stream */}
        <TabsContent value="dda-line" className="space-y-4">
          {selectedStreamId ? (
            <StreamingDDALinePlot streamId={selectedStreamId} height={500} />
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
                Select a stream to view the DDA line plot
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Heatmap Tab - Always mounted, shows placeholder when no stream */}
        <TabsContent value="heatmap" className="space-y-4">
          {selectedStreamId ? (
            <StreamingHeatmap streamId={selectedStreamId} height={500} />
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
                Select a stream to view the DDA heatmap
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Stream Configuration Dialog */}
      <StreamConfigDialog />

      {/* Quick Start Guide */}
      {allSessions.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
            <CardDescription>
              How to use real-time streaming and DDA analysis
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <h4 className="font-semibold">1. Choose a Data Source</h4>
                <p className="text-sm text-muted-foreground">
                  Connect to a live data stream via WebSocket, TCP, UDP, Serial
                  port, or use file playback for testing.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold">2. Configure DDA Parameters</h4>
                <p className="text-sm text-muted-foreground">
                  Set up sliding window parameters, scale ranges, and algorithm
                  selection for continuous analysis.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold">3. Monitor in Real-Time</h4>
                <p className="text-sm text-muted-foreground">
                  View live time series plots and DDA heatmaps updating as data
                  streams in, with auto-scroll and customizable display windows.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold">4. Manage Sessions</h4>
                <p className="text-sm text-muted-foreground">
                  Pause, resume, or stop streams at any time. Multiple
                  concurrent sessions are supported with independent
                  configurations.
                </p>
              </div>
            </div>

            <Separator />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Compact view for embedding in other pages
 */
export function StreamingViewCompact() {
  const { allSessions } = useActiveStreams();
  const selectedStreamId = useAppStore(
    (state) => state.streaming.ui.selectedStreamId,
  );
  const updateStreamUI = useAppStore((state) => state.updateStreamUI);

  if (allSessions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Activity className="h-10 w-10 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-4">
            No active streams
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => updateStreamUI({ isConfigDialogOpen: true })}
          >
            <Play className="h-3 w-3 mr-1" />
            Start Streaming
          </Button>
        </CardContent>
      </Card>
    );
  }

  const activeSession = selectedStreamId
    ? allSessions.find((s) => s.id === selectedStreamId)
    : allSessions[0];

  if (!activeSession) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Stream Selector */}
      {allSessions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Stream:</span>
          <div className="flex gap-1">
            {allSessions.map((session) => (
              <Button
                key={session.id}
                size="sm"
                variant={
                  session.id === activeSession.id ? "default" : "outline"
                }
                onClick={() => updateStreamUI({ selectedStreamId: session.id })}
              >
                {session.id.slice(0, 8)}...
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Control Panel */}
      <StreamControlPanel streamId={activeSession.id} showDetails={false} />

      {/* Plots */}
      <Tabs defaultValue="plot" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="plot">Time Series</TabsTrigger>
          <TabsTrigger value="dda-line">DDA Line</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
        </TabsList>

        <TabsContent value="plot">
          <StreamingPlot streamId={activeSession.id} height={300} />
        </TabsContent>

        <TabsContent value="dda-line">
          <StreamingDDALinePlot streamId={activeSession.id} height={300} />
        </TabsContent>

        <TabsContent value="heatmap">
          <StreamingHeatmap streamId={activeSession.id} height={300} />
        </TabsContent>
      </Tabs>

      <StreamConfigDialog />
    </div>
  );
}
