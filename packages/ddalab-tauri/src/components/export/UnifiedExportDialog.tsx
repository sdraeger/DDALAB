"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileText, Image, Database } from "lucide-react";

export interface ExportOption {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  fileExtension: string;
  estimatedSize?: string;
}

export interface UnifiedExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: string, options: ExportOptions) => Promise<void>;
  availableFormats: ExportOption[];
  title?: string;
  className?: string;
}

export interface ExportOptions {
  includeParameters?: boolean;
  includeMetadata?: boolean;
  includeRawData?: boolean;
  format?: "json" | "csv" | "xlsx" | "png" | "svg";
}

export const UnifiedExportDialog: React.FC<UnifiedExportDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  availableFormats,
  title = "Export Data",
  className = "",
}) => {
  const [selectedFormat, setSelectedFormat] = useState(
    availableFormats[0]?.id || "",
  );
  const [options, setOptions] = useState<ExportOptions>({
    includeParameters: true,
    includeMetadata: true,
    includeRawData: false,
  });
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await onExport(selectedFormat, options);
      onClose();
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const selectedFormatOption = availableFormats.find(
    (f) => f.id === selectedFormat,
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`sm:max-w-md ${className}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose export format and options for your data
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div>
            <Label className="text-base font-semibold mb-3 block">
              Export Format
            </Label>
            <RadioGroup
              value={selectedFormat}
              onValueChange={setSelectedFormat}
            >
              <div className="space-y-2">
                {availableFormats.map((format) => (
                  <div
                    key={format.id}
                    className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <RadioGroupItem
                      value={format.id}
                      id={format.id}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor={format.id}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        {format.icon}
                        <span className="font-medium">{format.label}</span>
                        <span className="text-xs text-muted-foreground">
                          (.{format.fileExtension})
                        </span>
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format.description}
                      </p>
                      {format.estimatedSize && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Est. size: {format.estimatedSize}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </RadioGroup>
          </div>

          {(selectedFormat === "csv" ||
            selectedFormat === "json" ||
            selectedFormat === "xlsx") && (
            <div>
              <Label className="text-base font-semibold mb-3 block">
                Include in Export
              </Label>
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-params"
                    checked={options.includeParameters}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, includeParameters: !!checked })
                    }
                  />
                  <Label
                    htmlFor="include-params"
                    className="text-sm cursor-pointer"
                  >
                    Analysis parameters
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-metadata"
                    checked={options.includeMetadata}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, includeMetadata: !!checked })
                    }
                  />
                  <Label
                    htmlFor="include-metadata"
                    className="text-sm cursor-pointer"
                  >
                    File metadata
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-raw"
                    checked={options.includeRawData}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, includeRawData: !!checked })
                    }
                  />
                  <Label
                    htmlFor="include-raw"
                    className="text-sm cursor-pointer"
                  >
                    Raw data (larger file size)
                  </Label>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            isLoading={isExporting}
            disabled={!selectedFormat}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export {selectedFormatOption?.fileExtension.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const DEFAULT_EXPORT_FORMATS: ExportOption[] = [
  {
    id: "csv",
    label: "CSV File",
    description:
      "Comma-separated values, compatible with Excel and analysis tools",
    icon: <FileText className="h-4 w-4" />,
    fileExtension: "csv",
  },
  {
    id: "json",
    label: "JSON File",
    description: "Structured data format, ideal for programmatic access",
    icon: <Database className="h-4 w-4" />,
    fileExtension: "json",
  },
  {
    id: "png",
    label: "PNG Image",
    description: "High-quality image of the current visualization",
    icon: <Image className="h-4 w-4" />,
    fileExtension: "png",
  },
];
