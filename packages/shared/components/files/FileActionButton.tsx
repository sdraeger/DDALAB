"use client";

import { Button } from "../ui/button";
import {
  BarChart3,
  ExternalLink,
  Download,
  MoreVertical,
  TrendingUp,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { usePersistentPlotActions } from "../../hooks/usePersistentPlotActions";
import { useState } from "react";

interface FileActionButtonProps {
  filePath: string;
  fileName: string;
  isEdfFile?: boolean;
  className?: string;
}

export function FileActionButton({
  filePath,
  fileName,
  isEdfFile = false,
  className,
}: FileActionButtonProps) {
  const { openEEGPlot, openDDAPlot, getOpenPlotForFile } =
    usePersistentPlotActions();
  const [isOpening, setIsOpening] = useState(false);

  const handleOpenEEGPlot = async () => {
    setIsOpening(true);
    try {
      await openEEGPlot(filePath, fileName);
    } catch (error) {
      console.error("Error opening EEG plot:", error);
    } finally {
      setIsOpening(false);
    }
  };

  const handleOpenDDAPlot = async () => {
    setIsOpening(true);
    try {
      await openDDAPlot(filePath, fileName);
    } catch (error) {
      console.error("Error opening DDA plot:", error);
    } finally {
      setIsOpening(false);
    }
  };

  const handleDownload = () => {
    // Create a download link
    const link = document.createElement("a");
    link.href = `/api/files/download?path=${encodeURIComponent(filePath)}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Check if this file already has open plots
  const existingEEGPlot = getOpenPlotForFile(filePath, "eeg");
  const existingDDAPlot = getOpenPlotForFile(filePath, "dda");

  if (!isEdfFile) {
    // For non-EDF files, just show download
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDownload}
        className={className}
        title={`Download ${fileName}`}
      >
        <Download className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {/* Quick action buttons for EDF files */}
      <Button
        variant={existingEEGPlot ? "default" : "outline"}
        size="sm"
        onClick={handleOpenEEGPlot}
        disabled={isOpening}
        className="gap-1"
        title={
          existingEEGPlot
            ? "EEG plot is already open"
            : "Open EEG plot in persistent window"
        }
      >
        <BarChart3 className="h-4 w-4" />
        {existingEEGPlot && (
          <span className="w-2 h-2 bg-green-500 rounded-full" />
        )}
      </Button>

      {/* More actions dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={className}
            title="More actions"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleOpenEEGPlot} disabled={isOpening}>
            <BarChart3 className="mr-2 h-4 w-4" />
            <span>Open EEG Plot</span>
            {existingEEGPlot && (
              <span className="ml-auto w-2 h-2 bg-green-500 rounded-full" />
            )}
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleOpenDDAPlot} disabled={isOpening}>
            <TrendingUp className="mr-2 h-4 w-4" />
            <span>Open DDA Plot</span>
            {existingDDAPlot && (
              <span className="ml-auto w-2 h-2 bg-green-500 rounded-full" />
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            <span>Download File</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(filePath);
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            <span>Copy Path</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
