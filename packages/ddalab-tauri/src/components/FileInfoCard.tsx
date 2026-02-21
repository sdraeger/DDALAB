"use client";

import { useMemo } from "react";
import { EDFFileInfo } from "@/types/api";
import { useAppStore } from "@/store/appStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { ChannelTypeBadge } from "./ChannelTypeBadge";
import {
  FileText,
  Clock,
  Activity,
  Layers,
  HardDrive,
  Calendar,
  Hash,
  Zap,
} from "lucide-react";

interface FileInfoCardProps {
  fileInfo: EDFFileInfo;
}

export function FileInfoCard({ fileInfo }: FileInfoCardProps) {
  // Get file annotations object from state (stable reference)
  const fileAnnotations = useAppStore(
    (state) => state.annotations.timeSeries[fileInfo.file_path],
  );

  // Memoize annotation counts to prevent infinite loops
  const annotations = useMemo(() => {
    if (!fileAnnotations) return { globalCount: 0, channelCount: 0 };

    const globalCount = fileAnnotations.globalAnnotations?.length || 0;
    const channelCount = Object.values(
      fileAnnotations.channelAnnotations || {},
    ).reduce((sum, anns) => sum + anns.length, 0);

    return { globalCount, channelCount };
  }, [fileAnnotations]);

  const totalAnnotationCount =
    annotations.globalCount + annotations.channelCount;
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  const formatDateTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            File Information
          </CardTitle>
          <Badge variant="outline" className="text-xs font-mono">
            {fileInfo.file_name.split(".").pop()?.toUpperCase() ?? ""}
          </Badge>
        </div>
        <p
          className="text-xs text-muted-foreground font-mono truncate"
          title={fileInfo.file_path}
        >
          {fileInfo.file_path}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard
            label="Channels"
            value={fileInfo.channels.length}
            icon={Layers}
            accentColor="blue"
          />
          <StatCard
            label="Sample Rate"
            value={`${fileInfo.sample_rate.toFixed(0)} Hz`}
            icon={Activity}
            accentColor="green"
          />
          <StatCard
            label="Duration"
            value={formatDuration(fileInfo.duration)}
            icon={Clock}
            accentColor="orange"
          />
          <StatCard
            label="File Size"
            value={formatFileSize(fileInfo.file_size)}
            icon={HardDrive}
            accentColor="purple"
          />
          <StatCard
            label="Samples"
            value={formatNumber(fileInfo.total_samples)}
            icon={Hash}
            accentColor="default"
          />
          <StatCard
            label="Annotations"
            value={totalAnnotationCount}
            icon={Zap}
            accentColor={totalAnnotationCount > 0 ? "blue" : "default"}
            description={
              totalAnnotationCount > 0
                ? `${annotations.globalCount} global, ${annotations.channelCount} channel`
                : undefined
            }
          />
        </div>

        <Separator />

        {/* Channel Info */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="h-4 w-4" />
              <span className="font-medium">Channels</span>
            </div>
            <Badge variant="secondary">
              {fileInfo.channels.length} channels
            </Badge>
          </div>

          <div className="max-h-40 overflow-y-auto border rounded-md p-3 bg-muted/30">
            <div className="flex flex-wrap gap-2">
              {fileInfo.channels.map((channel, idx) => (
                <Badge key={idx} variant="outline" className="text-xs gap-1">
                  {fileInfo.channel_types?.[idx] &&
                    fileInfo.channel_types[idx] !== "Unknown" && (
                      <ChannelTypeBadge type={fileInfo.channel_types[idx]} />
                    )}
                  {channel}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span className="font-medium">Recording</span>
          </div>
          <span className="text-muted-foreground">
            {formatDateTime(fileInfo.start_time)} —{" "}
            {formatDateTime(fileInfo.end_time)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
