"use client";

import { useState } from "react";
import { useAppStore } from "@/store/appStore";
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
  Clock,
  Play,
  Trash2,
  FileText,
  Globe,
  Network,
  Radio,
  Usb,
} from "lucide-react";

export function StreamHistoryList() {
  const recentSources = useAppStore(
    (state) => state.streaming.ui.recentSources,
  );
  const createStreamFromHistory = useAppStore(
    (state) => state.createStreamFromHistory,
  );
  const removeFromStreamHistory = useAppStore(
    (state) => state.removeFromStreamHistory,
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleStartStream = async (historyId: string) => {
    try {
      setLoadingId(historyId);
      await createStreamFromHistory(historyId);
    } catch (error) {
      console.error("Failed to start stream from history:", error);
    } finally {
      setLoadingId(null);
    }
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case "file":
        return <FileText className="h-4 w-4" />;
      case "websocket":
        return <Globe className="h-4 w-4" />;
      case "tcp":
      case "udp":
        return <Network className="h-4 w-4" />;
      case "serial":
        return <Usb className="h-4 w-4" />;
      default:
        return <Radio className="h-4 w-4" />;
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  if (recentSources.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Sources
          </CardTitle>
          <CardDescription>
            Your recently used streaming sources will appear here
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No recent sources yet</p>
            <p className="text-sm mt-1">
              Create a stream to see it appear here
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Recent Sources
        </CardTitle>
        <CardDescription>
          Quickly start a stream from a recent configuration
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {recentSources.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="text-muted-foreground">
                  {getSourceIcon(entry.sourceConfig.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{entry.displayName}</p>
                    <Badge variant="outline" className="text-xs">
                      {entry.sourceConfig.type}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatTimestamp(entry.timestamp)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleStartStream(entry.id)}
                  disabled={loadingId === entry.id}
                >
                  <Play className="h-3 w-3 mr-1" />
                  {loadingId === entry.id ? "Starting..." : "Start"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeFromStreamHistory(entry.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
