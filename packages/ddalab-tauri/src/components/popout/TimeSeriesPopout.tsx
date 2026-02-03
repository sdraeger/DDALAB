import React, { useEffect } from "react";
import { PopoutLayout } from "./PopoutLayout";
import { TimeSeriesPlotECharts } from "@/components/TimeSeriesPlotECharts";
import { useAppStore } from "@/store/appStore";
import type { EDFFileInfo } from "@/types/api";

interface TimeSeriesPopoutContentProps {
  data?: any;
  isLocked?: boolean;
  windowId?: string;
}

function TimeSeriesPopoutContent({
  data,
  isLocked,
  windowId,
}: TimeSeriesPopoutContentProps) {
  const setSelectedFile = useAppStore((state) => state.setSelectedFile);
  const setSelectedChannels = useAppStore((state) => state.setSelectedChannels);

  // Sync received data with store on initial load and updates
  useEffect(() => {
    if (!data || isLocked) {
      return;
    }

    // Mark persistence as restored so components don't wait
    useAppStore.setState({ isPersistenceRestored: true });

    // If we have file information in the data, sync it to the store
    if (data.filePath || data.file_path) {
      const totalDuration = data.duration || data.timeWindow || 0;
      const sampleRate = data.sampleRate || data.sample_rate || 500;

      const fileInfo: EDFFileInfo = {
        file_path: data.filePath || data.file_path,
        file_name: data.fileName || data.file_name || "Unknown",
        file_size: data.fileSize || data.file_size || 0,
        channels: data.channels || [],
        duration: totalDuration,
        sample_rate: sampleRate,
        total_samples:
          data.totalSamples ||
          data.total_samples ||
          Math.floor(totalDuration * sampleRate),
        start_time: data.startTime || data.start_time || "",
        end_time: data.endTime || data.end_time || "",
      };

      setSelectedFile(fileInfo);

      // Set selected channels if available
      if (data.selectedChannels && Array.isArray(data.selectedChannels)) {
        setSelectedChannels(data.selectedChannels);
      }
    }
  }, [data, isLocked, windowId, setSelectedFile, setSelectedChannels]);

  return (
    <div className="h-full w-full p-4 overflow-y-auto">
      <TimeSeriesPlotECharts />
    </div>
  );
}

export default function TimeSeriesPopout() {
  return (
    <PopoutLayout title="Time Series Visualization" showRefresh={false}>
      <TimeSeriesPopoutContent />
    </PopoutLayout>
  );
}
