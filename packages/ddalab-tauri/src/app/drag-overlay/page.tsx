"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  Activity,
  Brain,
  Database,
  File,
  FileSpreadsheet,
  FileText,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Get file type info based on extension */
function getFileTypeInfo(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  const fileTypeMap: Record<
    string,
    { icon: typeof File; colorClass: string; bgClass: string }
  > = {
    edf: {
      icon: Activity,
      colorClass: "text-emerald-500",
      bgClass: "bg-emerald-500/10",
    },
    vhdr: {
      icon: Brain,
      colorClass: "text-purple-500",
      bgClass: "bg-purple-500/10",
    },
    vmrk: {
      icon: Brain,
      colorClass: "text-purple-500",
      bgClass: "bg-purple-500/10",
    },
    eeg: {
      icon: Brain,
      colorClass: "text-purple-500",
      bgClass: "bg-purple-500/10",
    },
    set: {
      icon: Brain,
      colorClass: "text-blue-500",
      bgClass: "bg-blue-500/10",
    },
    fif: {
      icon: Activity,
      colorClass: "text-orange-500",
      bgClass: "bg-orange-500/10",
    },
    nii: {
      icon: Brain,
      colorClass: "text-pink-500",
      bgClass: "bg-pink-500/10",
    },
    xdf: {
      icon: Database,
      colorClass: "text-cyan-500",
      bgClass: "bg-cyan-500/10",
    },
    nwb: {
      icon: Database,
      colorClass: "text-indigo-500",
      bgClass: "bg-indigo-500/10",
    },
    csv: {
      icon: FileSpreadsheet,
      colorClass: "text-green-500",
      bgClass: "bg-green-500/10",
    },
    txt: {
      icon: FileText,
      colorClass: "text-gray-500",
      bgClass: "bg-gray-500/10",
    },
    asc: {
      icon: FileText,
      colorClass: "text-gray-500",
      bgClass: "bg-gray-500/10",
    },
  };

  return (
    fileTypeMap[ext] || {
      icon: File,
      colorClass: "text-muted-foreground",
      bgClass: "bg-muted",
    }
  );
}

function DragOverlayContent() {
  const searchParams = useSearchParams();
  const fileName = searchParams.get("fileName") || "File";
  const fileInfo = getFileTypeInfo(fileName);
  const FileIcon = fileInfo.icon;

  return (
    <div className="h-screen w-screen flex items-center justify-center p-1 bg-background">
      <div
        className={cn(
          "flex items-center gap-3 pl-3 pr-4 py-2.5",
          "rounded-xl bg-card",
          "border border-border/80",
          "shadow-xl shadow-black/10",
        )}
      >
        {/* File icon with colored background */}
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-lg",
            fileInfo.bgClass,
          )}
        >
          <FileIcon className={cn("h-4.5 w-4.5", fileInfo.colorClass)} />
        </div>

        {/* File name and action hint */}
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
            {fileName}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            <span>Drop to open in new window</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function DragOverlayPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-background" />
      }
    >
      <DragOverlayContent />
    </Suspense>
  );
}
