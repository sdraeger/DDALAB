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
import { useUnifiedSessionData } from "@/hooks/useUnifiedSession";
import apiService from "@/lib/api";
import { useCurrentFileSubscription } from "@/hooks/useCurrentFileSubscription";

interface DDAWidgetProps {
  widgetId?: string;
  isPopout?: boolean;
}

export function DDAWidget({
  widgetId = "dda-widget",
  isPopout = false,
}: DDAWidgetProps) {
  const { data: session } = useUnifiedSessionData();
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

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Auto-populate from current file selection
  useCurrentFileSubscription((event) => {
    if (event.filePath) setFilePath(event.filePath);
    if (Array.isArray(event.selectedChannels))
      setSelectedChannels(event.selectedChannels);
    
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
      if (Array.isArray(detail?.selectedChannels))
        setSelectedChannels(detail.selectedChannels);
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
      // Map selected channel names to 1-based indices expected by backend
      const channelIndices: number[] = selectedChannels
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
                selectedChannels,
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
    <div className="flex flex-col h-full p-2 space-y-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings className="h-4 w-4" />
            DDA Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-2">
            <Label htmlFor="filePath">
              EDF File Path (relative to data dir)
            </Label>
            <Input
              id="filePath"
              type="text"
              placeholder="subject01/session01/file.edf"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="windowSize">Window Size (s)</Label>
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
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stepSize">Step Size (s)</Label>
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
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="frequencyBand">Frequency Band</Label>
            <Select
              value={formData.frequencyBand}
              onValueChange={(value) =>
                handleInputChange("frequencyBand", value)
              }
            >
              <SelectTrigger>
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

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="enablePreprocessing"
                checked={formData.enablePreprocessing}
                onCheckedChange={(checked) =>
                  handleInputChange("enablePreprocessing", checked)
                }
              />
              <Label htmlFor="enablePreprocessing">Enable Preprocessing</Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="includeMetadata"
                checked={formData.includeMetadata}
                onCheckedChange={(checked) =>
                  handleInputChange("includeMetadata", checked)
                }
              />
              <Label htmlFor="includeMetadata">Include Metadata</Label>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              onClick={handleProcess}
              disabled={isProcessing}
              className="flex-1"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run DDA
                </>
              )}
            </Button>

            <Button variant="outline" size="icon">
              <Download className="h-4 w-4" />
            </Button>
          </div>
          {resultInfo && (
            <div
              className={`text-sm ${resultInfo.ok ? "text-green-600" : "text-red-600"}`}
            >
              {resultInfo.message}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
