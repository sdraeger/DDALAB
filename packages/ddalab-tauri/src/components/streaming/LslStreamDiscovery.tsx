import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/appStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingPlaceholder } from "@/components/ui/loading-overlay";
import { Loader2, RefreshCw, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface LslStreamInfo {
  name: string;
  stream_type: string;
  channel_count: number;
  sample_rate: number;
  source_id: string;
  hostname: string;
}

interface LslStreamDiscoveryProps {
  onSelectStream?: (stream: LslStreamInfo) => void;
  selectedStreamId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function LslStreamDiscovery({
  onSelectStream,
  selectedStreamId,
  autoRefresh = true,
  refreshInterval = 2000,
}: LslStreamDiscoveryProps) {
  const [streams, setStreams] = useState<LslStreamInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const bridgeState = useAppStore((state) => state.streaming.ui.bridgeState);
  const startLslBridge = useAppStore((state) => state.startLslBridge);

  const isBridgeRunning = bridgeState.type === "Running";

  const discoverStreams = useCallback(async () => {
    if (!isBridgeRunning) return;

    try {
      setLoading(true);
      setError(null);

      const discovered = await invoke<LslStreamInfo[]>("discover_lsl_streams", {
        timeoutSeconds: 1.0,
      });

      setStreams(discovered);
      setLastUpdate(new Date());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [isBridgeRunning]);

  // Auto-start bridge on mount if stopped
  useEffect(() => {
    if (bridgeState.type === "Stopped") {
      startLslBridge();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial discovery when bridge becomes running
  useEffect(() => {
    if (isBridgeRunning) {
      discoverStreams();
    }
  }, [isBridgeRunning, discoverStreams]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !isBridgeRunning) return;

    const interval = setInterval(() => {
      discoverStreams();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, discoverStreams, isBridgeRunning]);

  const getStreamTypeColor = (type: string): string => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes("eeg")) return "bg-blue-500";
    if (lowerType.includes("meg")) return "bg-purple-500";
    if (lowerType.includes("ecg")) return "bg-red-500";
    if (lowerType.includes("emg")) return "bg-orange-500";
    if (lowerType.includes("marker")) return "bg-green-500";
    if (lowerType.includes("gaze")) return "bg-cyan-500";
    return "bg-gray-500";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Available LSL Streams</CardTitle>
          <div className="flex items-center gap-2">
            {/* Bridge status indicator */}
            {bridgeState.type === "Starting" && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Starting bridge...
              </div>
            )}
            {bridgeState.type === "Running" && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                Bridge active
              </div>
            )}
            {bridgeState.type === "Error" && (
              <div className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Error
              </div>
            )}

            {lastUpdate && isBridgeRunning && (
              <span className="text-xs text-muted-foreground">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={discoverStreams}
              disabled={loading || !isBridgeRunning}
              className="h-8 w-8"
              aria-label="Refresh LSL streams"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Bridge error state */}
        {bridgeState.type === "Error" && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">LSL Bridge Error</p>
              <p className="text-xs mt-1">{bridgeState.message}</p>
              <p className="text-xs mt-2">
                Ensure Python 3 is installed with pylsl and websockets:
              </p>
              <code className="text-xs block mt-1 bg-muted p-1 rounded">
                pip install pylsl websockets
              </code>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => startLslBridge()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Bridge stopped state */}
        {bridgeState.type === "Stopped" && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <WifiOff className="h-8 w-8 mb-2" />
            <p className="text-sm">LSL bridge is not running</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => startLslBridge()}
            >
              Start Bridge
            </Button>
          </div>
        )}

        {/* Bridge starting state */}
        {bridgeState.type === "Starting" && (
          <LoadingPlaceholder
            message="Starting LSL bridge..."
            minHeight="150px"
          />
        )}

        {/* Bridge running - show discovery */}
        {isBridgeRunning && (
          <>
            {error && (
              <div
                className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                <p className="font-medium">Discovery Error</p>
                <p className="text-xs mt-1">{error}</p>
              </div>
            )}

            {loading && streams.length === 0 ? (
              <LoadingPlaceholder
                message="Searching for LSL streams..."
                minHeight="150px"
              />
            ) : streams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <WifiOff className="h-8 w-8 mb-2" />
                <p className="text-sm">No LSL streams found</p>
                <p className="text-xs mt-1">
                  Make sure an LSL stream is running on the network
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {streams.map((stream) => {
                    const isSelected = selectedStreamId === stream.source_id;

                    return (
                      <div
                        key={stream.source_id}
                        className={`
                          rounded-lg border p-3 cursor-pointer transition-all
                          ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "hover:border-primary/50 hover:bg-accent"
                          }
                        `}
                        onClick={() => onSelectStream?.(stream)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Wifi className="h-4 w-4 text-green-500" />
                            <h4 className="font-medium text-sm">
                              {stream.name}
                            </h4>
                          </div>
                          <Badge
                            className={`${getStreamTypeColor(
                              stream.stream_type,
                            )} text-white`}
                          >
                            {stream.stream_type}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium">Channels:</span>{" "}
                            {stream.channel_count}
                          </div>
                          <div>
                            <span className="font-medium">Rate:</span>{" "}
                            {stream.sample_rate} Hz
                          </div>
                          <div className="col-span-2">
                            <span className="font-medium">Host:</span>{" "}
                            {stream.hostname}
                          </div>
                          <div className="col-span-2 truncate">
                            <span className="font-medium">ID:</span>{" "}
                            {stream.source_id}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}

            {autoRefresh && (
              <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Auto-refreshing every {refreshInterval / 1000}s
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
