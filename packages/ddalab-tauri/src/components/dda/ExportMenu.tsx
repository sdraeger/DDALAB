"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Database,
  FileText,
  FileCode,
  FileImage,
  Image,
  Share2,
  ExternalLink,
} from "lucide-react";

interface ExportMenuProps {
  onExportData: (format: "csv" | "json") => void;
  onExportPlot: (format: "png" | "svg" | "pdf") => void;
  onShare?: () => void;
  onPopOut?: () => void;
  showShare?: boolean;
  showPopOut?: boolean;
}

export const ExportMenu = memo(function ExportMenu({
  onExportData,
  onExportPlot,
  onShare,
  onPopOut,
  showShare = false,
  showPopOut = true,
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
        <DropdownMenuContent align="end" noPortal>
          <DropdownMenuItem onClick={() => onExportData("csv")}>
            <FileText className="h-4 w-4 mr-2" />
            Export as CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportData("json")}>
            <FileCode className="h-4 w-4 mr-2" />
            Export as JSON
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Image className="h-4 w-4 mr-2" />
            Save Plot
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" noPortal>
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

      {showShare && onShare && (
        <Button
          variant="outline"
          size="sm"
          onClick={onShare}
          title="Share this result with colleagues"
        >
          <Share2 className="h-4 w-4 mr-2" />
          Share
        </Button>
      )}

      {showPopOut && onPopOut && (
        <Button
          variant="outline"
          size="sm"
          onClick={onPopOut}
          title="Pop out to separate window"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Pop Out
        </Button>
      )}
    </div>
  );
});
