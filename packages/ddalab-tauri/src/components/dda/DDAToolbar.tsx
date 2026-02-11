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
  Archive,
  Database,
  FileText,
  FileCode,
  FileImage,
  Image,
  Share2,
  ExternalLink,
  FolderDown,
  Loader2,
  FlaskConical,
} from "lucide-react";

export interface DDAExportActions {
  exportData: (format: "csv" | "json") => void;
  exportPlot: (format: "png" | "svg" | "pdf") => void;
  exportAllData?: (format: "csv" | "json") => void;
  exportScript: (format: "python" | "matlab" | "julia" | "rust") => void;
  exportSnapshot: (mode: "full" | "recipe_only") => void;
  popOut: () => void;
  share?: () => void;
  showExportAll: boolean;
}

interface DDAToolbarProps {
  onImportSnapshot: () => void;
  isImporting: boolean;
  exportActions: DDAExportActions | null;
}

export const DDAToolbar = memo(function DDAToolbar({
  onImportSnapshot,
  isImporting,
  exportActions,
}: DDAToolbarProps) {
  const hasExport = exportActions !== null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1.5">
        {/* Import Snapshot — always available */}
        <Button
          variant="outline"
          size="sm"
          onClick={onImportSnapshot}
          disabled={isImporting}
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Archive className="h-4 w-4 mr-1.5" />
          )}
          Import
        </Button>

        {/* Separator */}
        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Export Data */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!hasExport}>
                  <Database className="h-4 w-4 mr-1.5" />
                  Data
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {!hasExport && (
              <TooltipContent>
                <p>Run an analysis first</p>
              </TooltipContent>
            )}
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportActions?.exportData("csv")}>
              <FileText className="h-4 w-4 mr-2" />
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportActions?.exportData("json")}>
              <FileCode className="h-4 w-4 mr-2" />
              Export as JSON
            </DropdownMenuItem>
            {exportActions?.showExportAll && exportActions.exportAllData && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => exportActions.exportAllData?.("csv")}
                >
                  <FolderDown className="h-4 w-4 mr-2" />
                  Export All Variants (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => exportActions.exportAllData?.("json")}
                >
                  <FolderDown className="h-4 w-4 mr-2" />
                  Export All Variants (JSON)
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Reproduce (Python / MATLAB) */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!hasExport}>
                  <FlaskConical className="h-4 w-4 mr-1.5" />
                  Reproduce
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {!hasExport && (
              <TooltipContent>
                <p>Run an analysis first</p>
              </TooltipContent>
            )}
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => exportActions?.exportScript("python")}
            >
              <FileCode className="h-4 w-4 mr-2" />
              Python Script (.py)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => exportActions?.exportScript("matlab")}
            >
              <FileCode className="h-4 w-4 mr-2" />
              MATLAB Script (.m)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => exportActions?.exportScript("julia")}
            >
              <FileCode className="h-4 w-4 mr-2" />
              Julia Script (.jl)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => exportActions?.exportScript("rust")}
            >
              <FileCode className="h-4 w-4 mr-2" />
              Rust Source (.rs)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Save Plot */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!hasExport}>
                  <Image className="h-4 w-4 mr-1.5" />
                  Plot
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {!hasExport && (
              <TooltipContent>
                <p>Run an analysis first</p>
              </TooltipContent>
            )}
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportActions?.exportPlot("png")}>
              <FileImage className="h-4 w-4 mr-2" />
              Save as PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportActions?.exportPlot("svg")}>
              <FileCode className="h-4 w-4 mr-2" />
              Save as SVG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportActions?.exportPlot("pdf")}>
              <FileText className="h-4 w-4 mr-2" />
              Save as PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export Snapshot */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!hasExport}>
                  <Archive className="h-4 w-4 mr-1.5" />
                  Snapshot
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {!hasExport && (
              <TooltipContent>
                <p>Run an analysis first</p>
              </TooltipContent>
            )}
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => exportActions?.exportSnapshot("full")}
            >
              <Archive className="h-4 w-4 mr-2" />
              Full Snapshot (with results)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => exportActions?.exportSnapshot("recipe_only")}
            >
              <FileText className="h-4 w-4 mr-2" />
              Recipe Only (parameters)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Pop Out */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportActions?.popOut()}
              disabled={!hasExport}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {hasExport
                ? "Open in a separate window"
                : "Run an analysis first"}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Share — only when available */}
        {exportActions?.share && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportActions.share?.()}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Share with colleagues on sync server</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
});
