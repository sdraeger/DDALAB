import React, { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EDFFileInfo } from "@/types/api";
import { Folder, Loader2, Scissors } from "lucide-react";
import { TauriService } from "@/services/tauriService";
import { formatBytes } from "@/lib/utils";
import { ApiService } from "@/services/apiService";
import { useLoadFileInfo } from "@/hooks/useFileManagement";
import { toast } from "@/components/ui/toaster";

interface FileSegmentationDialogProps {
  open: boolean;
  onClose: () => void;
  file: EDFFileInfo | null;
  onSegment: (params: SegmentationParams) => Promise<void>;
  apiService: ApiService;
}

export interface SegmentationParams {
  filePath: string;
  startTime: number;
  startUnit: "seconds" | "samples";
  endTime: number;
  endUnit: "seconds" | "samples";
  outputDirectory: string;
  outputFormat: "same" | "edf" | "csv" | "ascii";
  outputFilename: string;
  selectedChannels: number[] | null;
}

export const FileSegmentationDialog: React.FC<FileSegmentationDialogProps> = ({
  open,
  onClose,
  file,
  onSegment,
  apiService,
}) => {
  const [startTime, setStartTime] = useState("0");
  const [startUnit, setStartUnit] = useState<"seconds" | "samples">("seconds");
  const [endTime, setEndTime] = useState("");
  const [endUnit, setEndUnit] = useState<"seconds" | "samples">("seconds");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [outputFormat, setOutputFormat] = useState<
    "same" | "edf" | "csv" | "ascii"
  >("same");
  const [outputFilename, setOutputFilename] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<Set<number>>(
    new Set(),
  );
  const [selectAllChannels, setSelectAllChannels] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadedFile, setLoadedFile] = useState<EDFFileInfo | null>(null);

  const loadFileInfoMutation = useLoadFileInfo(apiService);

  // Load full file info when dialog opens
  useEffect(() => {
    if (open && file) {
      // Reset form
      setStartTime("0");
      setStartUnit("seconds");
      setEndTime("");
      setEndUnit("seconds");
      setOutputFormat("same");
      setSelectAllChannels(true);
      setSelectedChannels(new Set());
      setLoadedFile(null);

      // Set default output directory to same directory as input file
      const fileDir = file.file_path.substring(
        0,
        file.file_path.lastIndexOf("/"),
      );
      setOutputDirectory(fileDir);

      // Set default output filename
      const baseName = file.file_name.substring(
        0,
        file.file_name.lastIndexOf("."),
      );
      const extension = getFileExtension(file.file_name);
      setOutputFilename(`${baseName}_cut.${extension}`);

      // Load full file info with channel information
      if (file.channels.length === 0) {
        console.log(
          "[SEGMENTATION] Loading full file info for channels:",
          file.file_path,
        );
        loadFileInfoMutation.mutate(file.file_path, {
          onSuccess: (fileInfo) => {
            console.log(
              "[SEGMENTATION] File info loaded with",
              fileInfo.channels.length,
              "channels",
            );
            setLoadedFile(fileInfo);
          },
          onError: (error) => {
            console.error("[SEGMENTATION] Failed to load file info:", error);
          },
        });
      } else {
        // File already has channels loaded
        setLoadedFile(file);
      }
    }
  }, [open, file]);

  const handleSelectDirectory = async () => {
    try {
      const selected = await TauriService.selectDirectory();
      if (selected) {
        setOutputDirectory(selected);
      }
    } catch (error) {
      console.error("Failed to select directory:", error);
    }
  };

  const toggleChannel = (channelIndex: number) => {
    setSelectedChannels((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(channelIndex)) {
        newSet.delete(channelIndex);
      } else {
        newSet.add(channelIndex);
      }
      return newSet;
    });
    setSelectAllChannels(false);
  };

  const toggleAllChannels = () => {
    if (selectAllChannels) {
      setSelectedChannels(new Set());
    } else {
      if (loadedFile) {
        setSelectedChannels(new Set(loadedFile.channels.map((_, idx) => idx)));
      }
    }
    setSelectAllChannels(!selectAllChannels);
  };

  const handleSegment = async () => {
    if (!file || !outputDirectory || !outputFilename) return;

    const start = parseFloat(startTime);
    const end = parseFloat(endTime);

    if (isNaN(start) || start < 0) {
      toast.error("Invalid Input", "Please enter a valid start time");
      return;
    }

    if (isNaN(end) || end <= 0) {
      toast.error("Invalid Input", "Please enter a valid end time");
      return;
    }

    if (end <= start) {
      toast.error("Invalid Input", "End time must be greater than start time");
      return;
    }

    if (!selectAllChannels && selectedChannels.size === 0) {
      toast.error("Invalid Input", "Please select at least one channel");
      return;
    }

    const params: SegmentationParams = {
      filePath: file.file_path,
      startTime: start,
      startUnit,
      endTime: end,
      endUnit,
      outputDirectory,
      outputFormat,
      outputFilename,
      selectedChannels: selectAllChannels ? null : Array.from(selectedChannels),
    };

    try {
      setIsProcessing(true);
      await onSegment(params);
      onClose();
    } catch (error) {
      console.error("Segmentation failed:", error);
      toast.error(
        "Segmentation Failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const getFileExtension = (filename: string): string => {
    const ext = filename.toLowerCase().split(".").pop();
    return ext || "";
  };

  const getOutputFormatDisplay = () => {
    if (!file) return "";
    if (outputFormat === "same") {
      const ext = getFileExtension(file.file_name);
      return ext.toUpperCase();
    }
    return outputFormat.toUpperCase();
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds.toFixed(2)} sec`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = (seconds % 60).toFixed(0);
      return `${minutes} min ${secs} sec`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours} hr ${minutes} min`;
    }
  };

  const calculateDuration = (): { valid: boolean; duration: string } => {
    const start = parseFloat(startTime);
    const end = parseFloat(endTime);

    if (isNaN(start) || isNaN(end) || end <= start) {
      return { valid: false, duration: "-" };
    }

    const duration = end - start;
    if (startUnit === "seconds" && endUnit === "seconds") {
      return { valid: true, duration: `${duration.toFixed(2)} seconds` };
    } else if (startUnit === "samples" && endUnit === "samples") {
      return { valid: true, duration: `${duration.toFixed(0)} samples` };
    } else {
      return { valid: true, duration: "Mixed units" };
    }
  };

  if (!file) return null;

  const durationInfo = calculateDuration();

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            Cut/Extract File Segment
          </AlertDialogTitle>
          <AlertDialogDescription>
            Extract a portion of the file between start and end points
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Processing Overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center rounded-lg">
            <div className="bg-card border rounded-lg p-6 shadow-lg flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center space-y-1">
                <div className="font-medium text-lg">Processing File</div>
                <div className="text-sm text-muted-foreground">
                  Cutting file segment, please wait...
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
          {/* File Info */}
          <div className="p-3 bg-muted rounded-lg space-y-2">
            <div className="text-sm font-medium">{file.file_name}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <div>
                <span className="font-medium">Size:</span>{" "}
                {formatBytes(file.file_size)}
              </div>
              <div>
                <span className="font-medium">Duration:</span>{" "}
                {loadedFile
                  ? formatDuration(loadedFile.duration)
                  : formatDuration(file.duration)}
              </div>
              <div>
                <span className="font-medium">Sample Rate:</span>{" "}
                {loadedFile
                  ? `${loadedFile.sample_rate} Hz`
                  : `${file.sample_rate} Hz`}
              </div>
              <div>
                <span className="font-medium">Channels:</span>{" "}
                {loadFileInfoMutation.isPending ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  loadedFile?.channels.length || file.channels.length || 0
                )}
              </div>
              <div>
                <span className="font-medium">Total Samples:</span>{" "}
                {(
                  loadedFile?.total_samples ||
                  file.total_samples ||
                  0
                ).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Start Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-time">Start Time/Sample</Label>
              <Input
                id="start-time"
                type="number"
                min="0"
                step="0.1"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="Start position"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-unit">Unit</Label>
              <Select
                value={startUnit}
                onValueChange={(value) =>
                  setStartUnit(value as "seconds" | "samples")
                }
              >
                <SelectTrigger id="start-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seconds">Seconds</SelectItem>
                  <SelectItem value="samples">Samples</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* End Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="end-time">End Time/Sample</Label>
              <Input
                id="end-time"
                type="number"
                min="0"
                step="0.1"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="End position"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-unit">Unit</Label>
              <Select
                value={endUnit}
                onValueChange={(value) =>
                  setEndUnit(value as "seconds" | "samples")
                }
              >
                <SelectTrigger id="end-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seconds">Seconds</SelectItem>
                  <SelectItem value="samples">Samples</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Duration Display */}
          {durationInfo.valid && (
            <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded text-sm">
              <strong>Duration:</strong> {durationInfo.duration}
            </div>
          )}

          {/* Output Format */}
          <div className="space-y-2">
            <Label htmlFor="output-format">Output Format</Label>
            <Select
              value={outputFormat}
              onValueChange={(value) =>
                setOutputFormat(value as "same" | "edf" | "csv" | "ascii")
              }
            >
              <SelectTrigger id="output-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same">
                  Same as input (
                  {getFileExtension(file.file_name).toUpperCase()})
                </SelectItem>
                <SelectItem value="edf">EDF</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="ascii">ASCII</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Output Directory */}
          <div className="space-y-2">
            <Label htmlFor="output-directory">Output Directory</Label>
            <div className="flex gap-2">
              <Input
                id="output-directory"
                value={outputDirectory}
                onChange={(e) => setOutputDirectory(e.target.value)}
                placeholder="Select output directory"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleSelectDirectory}
              >
                <Folder className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Output Filename */}
          <div className="space-y-2">
            <Label htmlFor="output-filename">Output Filename</Label>
            <Input
              id="output-filename"
              value={outputFilename}
              onChange={(e) => setOutputFilename(e.target.value)}
              placeholder="output_file.edf"
            />
          </div>

          {/* Channel Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Channels to Include</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={selectAllChannels}
                  onCheckedChange={toggleAllChannels}
                />
                <label htmlFor="select-all" className="text-sm cursor-pointer">
                  All channels
                </label>
              </div>
            </div>

            {!selectAllChannels && (
              <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                {loadFileInfoMutation.isPending ? (
                  <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading channels...
                  </div>
                ) : loadedFile && loadedFile.channels.length > 0 ? (
                  loadedFile.channels.map((channel, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Checkbox
                        id={`channel-${idx}`}
                        checked={selectedChannels.has(idx)}
                        onCheckedChange={() => toggleChannel(idx)}
                      />
                      <label
                        htmlFor={`channel-${idx}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {channel}
                      </label>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    No channels available
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Output Summary */}
          <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
            <div className="text-sm font-medium mb-1">Output Summary</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Format: {getOutputFormatDisplay()}</div>
              <div>
                Channels:{" "}
                {selectAllChannels
                  ? loadedFile?.channels.length || 0
                  : selectedChannels.size}
              </div>
              <div>Filename: {outputFilename}</div>
            </div>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSegment}
            disabled={
              isProcessing ||
              !outputDirectory ||
              !outputFilename ||
              !durationInfo.valid
            }
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Scissors className="h-4 w-4 mr-2" />
                Cut File
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
