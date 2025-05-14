// CHECK: This is the old dashboard, which is now deprecated.
// The new dashboard is in `DashboardTabs.tsx`

"use client";

import { useState, useRef } from "react";
import {
  FileUp,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Download,
  Share2,
  Settings,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Slider } from "../ui/slider";
import { EEGChart } from "../plot/eeg-chart";
import { FileSelector } from "../files/file-selector";
import { EEGZoomSettings } from "../settings/eeg-zoom-settings";
import { EEGData } from "../../types/eeg";
import { toast } from "../../hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import logger from "../../lib/utils/logger";

function QuickZoomSettings({ onClose }: { onClose: () => void }) {
  return (
    <div className="p-4">
      <EEGZoomSettings />
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export function EEGDashboard() {
  const [eegData, setEEGData] = useState<EEGData | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [timeWindow, setTimeWindow] = useState<[number, number]>([0, 10]); // seconds
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [showZoomSettings, setShowZoomSettings] = useState(false);

  const handleFileSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
  };

  // const handleFileSelected = async (files: FileList | null) => {
  //   if (!files || files.length === 0) return;

  //   try {
  //     setIsLoading(true);
  //     const file = files[0];

  //     // Check if file is an EDF file
  //     if (!file.name.toLowerCase().endsWith(".edf")) {
  //       toast({
  //         title: "Invalid file format",
  //         description: "Please select an .edf file",
  //         variant: "destructive",
  //       });
  //       return;
  //     }

  //     logger.info(`Processing file: ${file.name}, size: ${file.size} bytes`);
  //     setCurrentFileName(file.name);

  //     // Parse the EDF file
  //     const parsedData = await parseEDFFile(file);

  //     logger.info("EEG data loaded:", {
  //       channels: parsedData.channels.length,
  //       samplesPerChannel: parsedData.samplesPerChannel,
  //       sampleRate: parsedData.sampleRate,
  //       duration: parsedData.duration,
  //       dataArraySizes: parsedData.data.map(
  //         (channel: number[]) => channel.length
  //       ),
  //     });

  //     setEEGData(parsedData);

  //     // Select first 5 channels by default (or all if less than 5)
  //     setSelectedChannels(
  //       parsedData.channels.slice(0, Math.min(5, parsedData.channels.length))
  //     );

  //     // Reset zoom and time window
  //     setZoomLevel(1);
  //     setTimeWindow([0, Math.min(10, parsedData.duration)]);

  //     toast({
  //       title: "File loaded successfully",
  //       description: `Loaded ${parsedData.channels.length} channels of EEG data`,
  //     });
  //   } catch (error) {
  //     logger.error("Error loading EDF file:", error);
  //     toast({
  //       title: "Error loading file",
  //       description: "There was a problem processing the EDF file.",
  //       variant: "destructive",
  //     });
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  const handleZoomIn = () => {
    if (zoomLevel < 10) {
      const newZoom = zoomLevel * 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) / 1.5;
      setTimeWindow([
        Math.max(0, center - newDuration / 2),
        center + newDuration / 2,
      ]);
    }
  };

  const handleZoomOut = () => {
    if (zoomLevel > 0.1 && eegData) {
      const newZoom = zoomLevel / 1.5;
      setZoomLevel(newZoom);

      // Adjust time window to maintain center point
      const center = (timeWindow[0] + timeWindow[1]) / 2;
      const newDuration = (timeWindow[1] - timeWindow[0]) * 1.5;
      setTimeWindow([
        Math.max(0, center - newDuration / 2),
        Math.min(eegData.duration, center + newDuration / 2),
      ]);
    }
  };

  const handleReset = () => {
    if (eegData) {
      setZoomLevel(1);
      setTimeWindow([0, Math.min(10, eegData.duration)]);
    }
  };

  const handleTimeWindowChange = (values: number[]) => {
    if (eegData && values.length === 2) {
      setTimeWindow([values[0], values[1]]);
    }
  };

  const toggleChannel = (channel: string) => {
    if (selectedChannels.includes(channel)) {
      setSelectedChannels(selectedChannels.filter((ch) => ch !== channel));
    } else {
      setSelectedChannels([...selectedChannels, channel]);
    }
  };

  const handleExportImage = () => {
    if (!chartRef.current) return;

    try {
      const canvas = chartRef.current.querySelector("canvas");
      if (!canvas) {
        toast({
          title: "Export failed",
          description: "Could not find the chart canvas",
          variant: "destructive",
        });
        return;
      }

      // Create a temporary link element
      const link = document.createElement("a");
      link.download = `eeg-chart-${currentFileName || "export"}.png`;
      link.href = canvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export successful",
        description: "Chart image has been downloaded",
      });
    } catch (error) {
      logger.error("Error exporting image:", error);
      toast({
        title: "Export failed",
        description: "There was a problem exporting the chart image",
        variant: "destructive",
      });
    }
  };

  const handleShareLink = () => {
    // Generate a simple share URL with the current state
    // In a real app, you might want to save the state to a database and generate a unique ID
    const shareData = {
      fileName: currentFileName,
      channels: selectedChannels,
      timeWindow,
      zoomLevel,
    };

    // Create a base64 encoded string of the data
    const encodedData = btoa(JSON.stringify(shareData));
    const url = `${window.location.origin}${window.location.pathname}?share=${encodedData}`;

    setShareUrl(url);
  };

  const handleCopyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast({
      title: "Link copied",
      description: "Share link has been copied to clipboard",
    });
  };

  return (
    <div className="w-full max-w-7xl">
      <Card className="mb-6">
        <CardContent>
          <FileSelector
            ref={fileInputRef}
            onFilesSelected={handleFileSelected}
            isLoading={isLoading}
            accept=".edf"
          />
        </CardContent>
      </Card>

      {eegData ? (
        <>
          <div className="flex flex-wrap gap-4 mb-6">
            <Card className="flex-1 min-w-[300px]">
              <CardHeader>
                <CardTitle>File Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="font-medium">File:</div>
                  <div>{currentFileName || "Unknown"}</div>
                  <div className="font-medium">Channels:</div>
                  <div>{eegData.channels.length}</div>
                  <div className="font-medium">Duration:</div>
                  <div>{eegData.duration.toFixed(1)} seconds</div>
                  <div className="font-medium">Sample Rate:</div>
                  <div>{eegData.sampleRate} Hz</div>
                  <div className="font-medium">Start Time:</div>
                  <div>{eegData.startTime.toLocaleString()}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="flex-1 min-w-[300px]">
              <CardHeader>
                <CardTitle>Visualization Controls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Button onClick={handleZoomIn} size="sm" variant="outline">
                    <ZoomIn className="h-4 w-4 mr-1" /> Zoom In
                  </Button>
                  <Button onClick={handleZoomOut} size="sm" variant="outline">
                    <ZoomOut className="h-4 w-4 mr-1" /> Zoom Out
                  </Button>
                  <Button onClick={handleReset} size="sm" variant="outline">
                    <RefreshCw className="h-4 w-4 mr-1" /> Reset View
                  </Button>
                </div>
                <div className="mt-4">
                  <div className="text-sm font-medium mb-2">
                    Time Window: {timeWindow[0].toFixed(1)}s -{" "}
                    {timeWindow[1].toFixed(1)}s
                  </div>
                  <Slider
                    defaultValue={[0, 10]}
                    value={[timeWindow[0], timeWindow[1]]}
                    max={eegData.duration}
                    step={0.1}
                    onValueChange={handleTimeWindowChange}
                    className="mt-2"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>EEG Visualization</CardTitle>
                <CardDescription>
                  Drag to pan, use controls to zoom in/out
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  title="Zoom In"
                  onClick={handleZoomIn}
                  disabled={!eegData || zoomLevel >= 10}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="Zoom Out"
                  onClick={handleZoomOut}
                  disabled={!eegData || zoomLevel <= 0.1}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="Reset View"
                  onClick={handleReset}
                  disabled={!eegData}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="Export as Image"
                  onClick={handleExportImage}
                  disabled={!eegData}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      title="Share"
                      onClick={handleShareLink}
                      disabled={!eegData}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Share this view</DialogTitle>
                      <DialogDescription>
                        Copy the link below to share your current EEG view with
                        others.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center space-x-2">
                      <Input
                        value={shareUrl}
                        readOnly
                        onClick={(e) => e.currentTarget.select()}
                      />
                      <Button onClick={handleCopyShareLink}>Copy</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Dialog
                  open={showZoomSettings}
                  onOpenChange={setShowZoomSettings}
                >
                  <DialogTrigger asChild>
                    <Button variant="outline" size="icon" title="Zoom Settings">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Zoom Settings</DialogTitle>
                      <DialogDescription>
                        Customize how the EEG chart responds to mouse wheel
                        zooming
                      </DialogDescription>
                    </DialogHeader>
                    <QuickZoomSettings
                      onClose={() => setShowZoomSettings(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="chart" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="chart">Chart View</TabsTrigger>
                  <TabsTrigger value="channels">Channel Selection</TabsTrigger>
                </TabsList>
                <TabsContent value="chart" className="w-full">
                  <div
                    className="w-full h-[600px] border rounded-md"
                    ref={chartRef}
                  >
                    <EEGChart
                      eegData={eegData}
                      selectedChannels={selectedChannels}
                      timeWindow={timeWindow}
                      zoomLevel={zoomLevel}
                      onTimeWindowChange={setTimeWindow}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="channels">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {eegData.channels.map((channel) => (
                      <Button
                        key={channel}
                        variant={
                          selectedChannels.includes(channel)
                            ? "default"
                            : "outline"
                        }
                        onClick={() => toggleChannel(channel)}
                        className="justify-start"
                      >
                        {channel}
                      </Button>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
            <CardFooter className="text-sm text-muted-foreground">
              Displaying {selectedChannels.length} of {eegData.channels.length}{" "}
              channels
            </CardFooter>
          </Card>
        </>
      ) : (
        <Card className="bg-muted/40">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileUp className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              Upload an EDF file to visualize EEG data
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
