import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Play, Download } from "lucide-react";
import { useUnifiedSessionData } from "@/hooks/useUnifiedSession";
import apiService from "@/lib/api";

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

  // Auto-populate from current selection events
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

  const handleProcessDDA = async () => {
    if (!session?.user || !filePath || selectedChannels.length === 0) {
      setResultInfo({
        message: "Please select a file and channels first",
        ok: false,
      });
      return;
    }

    setIsProcessing(true);
    setResultInfo(null);

    try {
      const response = await apiService.processDDA({
        filePath,
        selectedChannels,
        parameters: formData,
      });

      setResultInfo({
        message: response.message || "DDA processing completed successfully",
        ok: true,
      });
    } catch (error: any) {
      setResultInfo({
        message: error.message || "DDA processing failed",
        ok: false,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          DDA Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File info */}
        {filePath && (
          <div className="text-sm text-muted-foreground">
            File: {filePath.split("/").pop()}
          </div>
        )}

        {/* Window Size */}
        <div className="space-y-2">
          <Label htmlFor="window-size">Window Size (seconds)</Label>
          <Input
            id="window-size"
            type="number"
            step="0.1"
            value={formData.windowSize}
            onChange={(e) =>
              handleInputChange("windowSize", parseFloat(e.target.value))
            }
            disabled={isProcessing}
          />
        </div>

        {/* Step Size */}
        <div className="space-y-2">
          <Label htmlFor="step-size">Step Size (seconds)</Label>
          <Input
            id="step-size"
            type="number"
            step="0.1"
            value={formData.stepSize}
            onChange={(e) =>
              handleInputChange("stepSize", parseFloat(e.target.value))
            }
            disabled={isProcessing}
          />
        </div>

        {/* Frequency Band */}
        <div className="space-y-2">
          <Label htmlFor="freq-band">Frequency Band</Label>
          <Select
            value={formData.frequencyBand}
            onValueChange={(value) => handleInputChange("frequencyBand", value)}
            disabled={isProcessing}
          >
            <SelectTrigger id="freq-band">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5-4">Delta (0.5-4 Hz)</SelectItem>
              <SelectItem value="4-8">Theta (4-8 Hz)</SelectItem>
              <SelectItem value="8-12">Alpha (8-12 Hz)</SelectItem>
              <SelectItem value="12-30">Beta (12-30 Hz)</SelectItem>
              <SelectItem value="30-100">Gamma (30-100 Hz)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Options */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="preprocessing"
              checked={formData.enablePreprocessing}
              onCheckedChange={(checked) =>
                handleInputChange("enablePreprocessing", checked)
              }
              disabled={isProcessing}
            />
            <Label htmlFor="preprocessing">Enable Preprocessing</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="metadata"
              checked={formData.includeMetadata}
              onCheckedChange={(checked) =>
                handleInputChange("includeMetadata", checked)
              }
              disabled={isProcessing}
            />
            <Label htmlFor="metadata">Include Metadata</Label>
          </div>
        </div>

        {/* Selected Channels */}
        {selectedChannels.length > 0 && (
          <div className="text-sm">
            <span className="font-medium">Selected channels:</span>{" "}
            {selectedChannels.join(", ")}
          </div>
        )}

        {/* Process Button */}
        <Button
          onClick={handleProcessDDA}
          disabled={
            isProcessing || !filePath || selectedChannels.length === 0
          }
          className="w-full"
        >
          {isProcessing ? (
            <>Processing...</>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Run DDA Analysis
            </>
          )}
        </Button>

        {/* Result Message */}
        {resultInfo && (
          <div
            className={`p-3 rounded-md text-sm ${
              resultInfo.ok
                ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200"
                : "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200"
            }`}
          >
            {resultInfo.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
