"use client";

import { useEffect, useState } from "react";
import { PopoutLayout } from "./PopoutLayout";
import { PhaseSpacePlot } from "@/components/dda/PhaseSpacePlot";
import { useAppStore } from "@/store/appStore";
import { usePopoutListener } from "@/hooks/usePopoutWindows";

interface PhaseSpacePopoutData {
  filePath: string;
  channels: string[];
  sampleRate: number;
  channelIndex?: number;
  delay?: number;
}

interface PhaseSpacePopoutContentProps {
  data?: any;
  isLocked?: boolean;
  windowId?: string;
}

function PhaseSpacePopoutContent({
  data,
  isLocked,
}: PhaseSpacePopoutContentProps) {
  const [popoutData, setPopoutData] = useState<PhaseSpacePopoutData | null>(
    null,
  );

  useEffect(() => {
    if (data && !isLocked) {
      setPopoutData({
        filePath: data.filePath || data.file_path || "",
        channels: data.channels || [],
        sampleRate: data.sampleRate || data.sample_rate || 256,
        channelIndex: data.channelIndex,
        delay: data.delay,
      });
    }
  }, [data, isLocked]);

  // Mark persistence as restored for popout windows
  useEffect(() => {
    useAppStore.setState({ isPersistenceRestored: true });
  }, []);

  if (!popoutData?.filePath) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <p className="text-muted-foreground">Waiting for data...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full p-4">
      <PhaseSpacePlot
        filePath={popoutData.filePath}
        channels={popoutData.channels}
        sampleRate={popoutData.sampleRate}
        className="h-full"
        isPopout={true}
      />
    </div>
  );
}

export default function PhaseSpacePopout() {
  return (
    <PopoutLayout title="3D Phase Space" showRefresh={false}>
      <PhaseSpacePopoutContent />
    </PopoutLayout>
  );
}
