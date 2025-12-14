"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Database,
  FileText,
  FileCode,
  FileImage,
  Image,
  Share2,
  ExternalLink,
  FolderDown,
} from "lucide-react";

interface ExportMenuProps {
  onExportData: (format: "csv" | "json") => void;
  onExportPlot: (format: "png" | "svg" | "pdf") => void;
  onExportAllData?: (format: "csv" | "json") => void;
  onShare?: () => void;
  onPopOut?: () => void;
  showShare?: boolean;
  showPopOut?: boolean;
  showExportAll?: boolean;
}

export const ExportMenu = memo(function ExportMenu({
  onExportData,
  onExportPlot,
  onExportAllData,
  onShare,
  onPopOut,
  showShare = false,
  showPopOut = true,
  showExportAll = false,
}: ExportMenuProps) {
  return (
    <div className="flex items-center space-x-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Database className="h-4 w-4 mr-2" />
            Export Data
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onExportData("csv")}>
            <FileText className="h-4 w-4 mr-2" />
            Export as CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportData("json")}>
            <FileCode className="h-4 w-4 mr-2" />
            Export as JSON
          </DropdownMenuItem>
          {showExportAll && onExportAllData && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onExportAllData("csv")}>
                <FolderDown className="h-4 w-4 mr-2" />
                Export All Variants (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExportAllData("json")}>
                <FolderDown className="h-4 w-4 mr-2" />
                Export All Variants (JSON)
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Image className="h-4 w-4 mr-2" />
            Save Plot
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onExportPlot("png")}>
            <FileImage className="h-4 w-4 mr-2" />
            Save as PNG
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportPlot("svg")}>
            <FileCode className="h-4 w-4 mr-2" />
            Save as SVG
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportPlot("pdf")}>
            <FileText className="h-4 w-4 mr-2" />
            Save as PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TooltipProvider delayDuration={300}>
        {showShare && onShare && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={onShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Share this DDA result with colleagues on the sync server</p>
            </TooltipContent>
          </Tooltip>
        )}

        {showPopOut && onPopOut && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={onPopOut}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Pop Out
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Open in a separate window for side-by-side comparison</p>
            </TooltipContent>
          </Tooltip>
        )}
      </TooltipProvider>
    </div>
  );
});
