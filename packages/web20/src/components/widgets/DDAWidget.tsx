"use client";

import React, { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Settings, Play, Download } from "lucide-react";
import { ScrollArea } from "../ui/scroll-area";
import { useUnifiedSessionData } from "@/hooks/useUnifiedSession";
import apiService from "@/lib/api";
import { useCurrentFileSubscription, useCurrentFileInfo } from "@/hooks/useCurrentFileSubscription";

interface DDAWidgetProps {
  widgetId?: string;
  isPopout?: boolean;
}

export function DDAWidget({
  widgetId = "dda-widget",
  isPopout = false,
}: DDAWidgetProps) {
  const { data: session } = useUnifiedSessionData();
  const { currentFilePath, currentPlotState } = useCurrentFileInfo();
  const [formData, setFormData] = useState({
    windowSize: 1.0,
    stepSize: 0.5,
    frequencyBand: "8-12",
    enablePreprocessing: true,
    includeMetadata: false,
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [filePath, setFilePath] = useState<string>("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<any>(null);
  const [resultInfo, setResultInfo] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const [ddaSelectedChannels, setDdaSelectedChannels] = useState<string[]>([]);

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Initialize widget with current file state when component mounts
  useEffect(() => {
    if (currentFilePath && currentPlotState) {
      setFilePath(currentFilePath);
      if (Array.isArray(currentPlotState.selectedChannels)) {
        setSelectedChannels(currentPlotState.selectedChannels);
        // Initialize DDA selected channels with plot's selected channels
        setDdaSelectedChannels(currentPlotState.selectedChannels);
      }
      
      const channelLabels =
        currentPlotState.edfData?.channel_labels ||
        currentPlotState.metadata?.channels ||
        currentPlotState.metadata?.availableChannels ||
        [];
      if (Array.isArray(channelLabels)) setAvailableChannels(channelLabels);
      if (currentPlotState.metadata) setMetadata(currentPlotState.metadata);
    }
  }, [currentFilePath, currentPlotState]);

  // Auto-populate from current file selection changes
  useCurrentFileSubscription((event) => {
    if (event.filePath) setFilePath(event.filePath);
    if (Array.isArray(event.selectedChannels)) {
      setSelectedChannels(event.selectedChannels);
      // Initialize DDA selected channels with plot's selected channels
      setDdaSelectedChannels(event.selectedChannels);
    }
    
    const channelLabels =
      event.edfData?.channel_labels ||
      event.metadata?.channels ||
      event.metadata?.availableChannels ||
      [];
    if (Array.isArray(channelLabels)) setAvailableChannels(channelLabels);
    if (event.metadata) setMetadata(event.metadata);
  });

  // Also listen for the old dda:edf-loaded event for backward compatibility
  useEffect(() => {
    const onEdfLoaded = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        filePath?: string;
        selectedChannels?: string[];
        metadata?: any;
        edfData?: { channel_labels?: string[] };
      };
      if (detail?.filePath) setFilePath(detail.filePath);
      if (Array.isArray(detail?.selectedChannels)) {
        setSelectedChannels(detail.selectedChannels);
        // Initialize DDA selected channels with plot's selected channels
        setDdaSelectedChannels(detail.selectedChannels);
      }
      const channelLabels =
        detail?.edfData?.channel_labels ||
        detail?.metadata?.channels ||
        detail?.metadata?.availableChannels ||
        [];
      if (Array.isArray(channelLabels)) setAvailableChannels(channelLabels);
      if (detail?.metadata) setMetadata(detail.metadata);
    };
    window.addEventListener("dda:edf-loaded", onEdfLoaded as EventListener);
    return () =>
      window.removeEventListener(
        "dda:edf-loaded",
        onEdfLoaded as EventListener
      );
  }, []);

  const handleProcess = async () => {
    if (!filePath) {
      setResultInfo({ ok: false, message: "Please specify an EDF file path" });
      return;
    }
    if (ddaSelectedChannels.length === 0) {
      setResultInfo({ ok: false, message: "Please select at least one channel for DDA processing" });
      return;
    }
    setIsProcessing(true);
    setResultInfo(null);

    try {
      const token = session?.accessToken || session?.data?.accessToken || null;
      apiService.setToken(token);
      const body = {
        file_path: filePath,
        preprocessing_options: formData.enablePreprocessing
          ? {
              notch_filter: formData.frequencyBand.includes("-")
                ? undefined
                : undefined,
              detrend: false,
            }
          : undefined,
      };
      // Map DDA selected channel names to 1-based indices expected by backend
      const channelIndices: number[] = ddaSelectedChannels
        .map((name) => availableChannels.indexOf(name))
        .filter((idx) => idx >= 0)
        .map((idx) => idx + 1);

      const { data: res, error } = await apiService.request<{
        Q: number[][];
        error?: string;
        error_message?: string;
        file_path?: string;
        metadata?: any;
      }>("/api/dda", {
        method: "POST",
        body: JSON.stringify({ ...body, channel_list: channelIndices }),
      });
      if (error) {
        setResultInfo({ ok: false, message: error });
        return;
      }
      if (res && Array.isArray(res.Q) && res.Q.length > 0) {
        setResultInfo({
          ok: true,
          message: `DDA completed. Q rows: ${res.Q.length}`,
        });
        try {
          // Broadcast results for plot widgets
          window.dispatchEvent(
            new CustomEvent("dda:results", {
              detail: {
                filePath: res.file_path || filePath,
                Q: res.Q,
                selectedChannels: ddaSelectedChannels,
                metadata: res.metadata ?? metadata,
              },
            })
          );
        } catch (_) {
          // no-op
        }
      } else if ((res as any)?.error) {
        setResultInfo({
          ok: false,
          message: (res as any).error_message || "DDA failed",
        });
      } else {
        setResultInfo({ ok: false, message: "No results returned" });
      }
    } catch (e: any) {
      setResultInfo({ ok: false, message: e?.message || "Request failed" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-1">
      <Card className="flex flex-col h-full">
        <CardHeader className="pb-1 pt-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Settings className="h-3 w-3" />
            DDA Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-2 p-2">
          <div className="space-y-1">
            <Label htmlFor="filePath" className="text-xs">
              EDF File Path
            </Label>
            <Input
              id="filePath"
              type="text"
              placeholder="file.edf"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="windowSize" className="text-xs">Window (s)</Label>
              <Input
                id="windowSize"
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={formData.windowSize}
                onChange={(e) =>
                  handleInputChange("windowSize", parseFloat(e.target.value))
                }
                className="h-7 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="stepSize" className="text-xs">Step (s)</Label>
              <Input
                id="stepSize"
                type="number"
                step="0.1"
                min="0.1"
                max="5"
                value={formData.stepSize}
                onChange={(e) =>
                  handleInputChange("stepSize", parseFloat(e.target.value))
                }
                className="h-7 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="frequencyBand" className="text-xs">Frequency Band</Label>
            <Select
              value={formData.frequencyBand}
              onValueChange={(value) =>
                handleInputChange("frequencyBand", value)
              }
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8-12">Alpha (8-12 Hz)</SelectItem>
                <SelectItem value="13-30">Beta (13-30 Hz)</SelectItem>
                <SelectItem value="4-8">Theta (4-8 Hz)</SelectItem>
                <SelectItem value="0.5-4">Delta (0.5-4 Hz)</SelectItem>
                <SelectItem value="30-100">Gamma (30-100 Hz)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Channels ({ddaSelectedChannels.length}/{availableChannels.length})</Label>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDdaSelectedChannels(availableChannels)}
                  className="h-5 px-2 text-xs"
                >
                  All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDdaSelectedChannels([])}
                  className="h-5 px-2 text-xs"
                >
                  None
                </Button>
              </div>
            </div>
            <ScrollArea className="h-20 border rounded p-1">
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {availableChannels.map((channel) => (
                  <div key={channel} className="flex items-center space-x-1">
                    <Checkbox
                      id={`channel-${channel}`}
                      checked={ddaSelectedChannels.includes(channel)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setDdaSelectedChannels([...ddaSelectedChannels, channel]);
                        } else {
                          setDdaSelectedChannels(ddaSelectedChannels.filter(ch => ch !== channel));
                        }
                      }}
                      className="h-3 w-3"
                    />
                    <Label htmlFor={`channel-${channel}`} className="text-xs cursor-pointer">
                      {channel}
                    </Label>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="flex gap-4">
            <div className="flex items-center space-x-1">
              <Checkbox
                id="enablePreprocessing"
                checked={formData.enablePreprocessing}
                onCheckedChange={(checked) =>
                  handleInputChange("enablePreprocessing", checked)
                }
                className="h-3 w-3"
              />
              <Label htmlFor="enablePreprocessing" className="text-xs">Preprocessing</Label>
            </div>

            <div className="flex items-center space-x-1">
              <Checkbox
                id="includeMetadata"
                checked={formData.includeMetadata}
                onCheckedChange={(checked) =>
                  handleInputChange("includeMetadata", checked)
                }
                className="h-3 w-3"
              />
              <Label htmlFor="includeMetadata" className="text-xs">Metadata</Label>
            </div>
          </div>

        </CardContent>
        <div className="p-2 pt-0 space-y-1">
          <div className="flex gap-2">
            <Button
              onClick={handleProcess}
              disabled={isProcessing}
              className="flex-1 h-8 text-xs"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Run DDA
                </>
              )}
            </Button>

            <Button variant="outline" size="sm" className="h-8 w-8 p-0">
              <Download className="h-3 w-3" />
            </Button>
          </div>
          {resultInfo && (
            <div
              className={`text-xs ${resultInfo.ok ? "text-green-600" : "text-red-600"}`}
            >
              {resultInfo.message}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
