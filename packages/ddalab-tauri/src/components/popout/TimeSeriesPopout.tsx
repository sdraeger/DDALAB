import React, { useEffect, useState } from "react";
import { PopoutLayout } from "./PopoutLayout";
import { TimeSeriesPlotECharts } from "@/components/TimeSeriesPlotECharts";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { TauriService } from "@/services/tauriService";
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
  const [apiService, setApiService] = useState<ApiService | null>(null);

  // Initialize API service with correct protocol from config
  useEffect(() => {
    const initApiService = async () => {
      if (!TauriService.isTauri()) {
        // In web mode, use default
        setApiService(new ApiService("http://localhost:8765"));
        return;
      }

      try {
        const apiConfig = await TauriService.getApiConfig();
        // CRITICAL: Default to HTTP if use_https is not explicitly true
        const protocol = apiConfig?.use_https === true ? "https" : "http";
        const port = apiConfig?.port || 8765;
        const url = `${protocol}://localhost:${port}`;
        const sessionToken = apiConfig?.session_token;

        // CRITICAL: Pass session token to ApiService for authentication
        setApiService(new ApiService(url, sessionToken));
      } catch (error) {
        console.error("[POPOUT-TIMESERIES] Failed to get API config:", error);
        // Fallback to HTTP (without token - will fail auth but better than crash)
        setApiService(new ApiService("http://localhost:8765"));
      }
    };

    initApiService();
  }, []);

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

  if (!apiService) {
    return (
      <div className="h-full w-full p-4 flex items-center justify-center">
        <p className="text-muted-foreground">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full p-4 overflow-y-auto">
      <TimeSeriesPlotECharts apiService={apiService} />
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
