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
