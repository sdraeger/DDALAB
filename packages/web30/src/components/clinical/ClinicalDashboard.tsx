"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Activity,
  BarChart3,
  Image,
  Settings,
  Maximize2,
  Brain,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { FileManager } from "./FileManager";
import { EEGVisualization } from "./EEGVisualization";
import { AnnotationPanel } from "./AnnotationPanel";
import { DDAAnalysisPanel } from "./DDAAnalysisPanel";
import { PlotVisualization } from "./PlotVisualization";
import { ChannelSelector } from "@/components/eeg/ChannelSelector";
import { FilterPipeline } from "@/components/eeg/FilterPipeline";
import {
  apiService,
  EDFFileInfo,
  Annotation,
  DDAResult,
} from "@/services/apiService";
import { EEGChannel, ChannelPreset, FilterConfig } from "@/types/eeg";
import { cn } from "@/lib/utils";
import { InterfaceSelector } from "@shared/components/ui/interface-selector";

interface ClinicalDashboardProps {
  className?: string;
}

export function ClinicalDashboard({ className }: ClinicalDashboardProps) {
  // File and data state
  const [selectedFile, setSelectedFile] = useState<EDFFileInfo | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation>();
  const [ddaResults, setDDAResults] = useState<DDAResult[]>([]);
  const [selectedDDAResult, setSelectedDDAResult] = useState<DDAResult>();

  // UI state
  const [activeTab, setActiveTab] = useState("eeg");
  const [currentTimeWindow, setCurrentTimeWindow] = useState({
    start: 0,
    end: 30,
  });
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [channelPresets, setChannelPresets] = useState<ChannelPreset[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Convert file channels to EEGChannel format
  const eegChannels: EEGChannel[] =
    selectedFile?.channels.map((channel, index) => ({
      id: channel.toLowerCase(),
      label: channel,
      position: { x: Math.random(), y: Math.random(), z: Math.random() },
      group: getChannelGroup(channel),
      active: true,
    })) || [];

  // Load annotations when file changes
  useEffect(() => {
    if (selectedFile) {
      loadAnnotations();
    }
  }, [selectedFile]);

  const loadAnnotations = useCallback(async () => {
    if (!selectedFile) return;

    try {
      const fileAnnotations = await apiService.getAnnotations(
        selectedFile.file_path
      );
      setAnnotations(fileAnnotations);
    } catch (error) {
      // The apiService.getAnnotations method should handle 404s silently
      // If we get here, it's likely a different error
      if (
        error instanceof Error &&
        !(
          error.message.includes("404") ||
          error.message.includes("Not Found") ||
          error.message.includes("API Error: 404")
        )
      ) {
        console.error("Failed to load annotations (unexpected error):", error);
      }
      // Always ensure we have an empty array
      setAnnotations([]);
    }
  }, [selectedFile]);

  // Handle file selection
  const handleFileSelect = useCallback((file: EDFFileInfo) => {
    setSelectedFile(file);
    setSelectedChannels(file.channels.slice(0, 8)); // Select first 8 channels by default
    setCurrentTimeWindow({ start: 0, end: Math.min(30, file.duration) });
    setAnnotations([]);
    setSelectedAnnotation(undefined);
    setDDAResults([]);
    setSelectedDDAResult(undefined);
  }, []);

  // Handle channel selection
  const handleChannelSelectionChange = useCallback((channelIds: string[]) => {
    setSelectedChannels(channelIds);
  }, []);

  // Handle preset save
  const handlePresetSave = useCallback((preset: Omit<ChannelPreset, "id">) => {
    const newPreset: ChannelPreset = {
      ...preset,
      id: `preset-${Date.now()}`,
    };
    setChannelPresets((prev) => [...prev, newPreset]);
  }, []);

  // Annotation management
  const handleAnnotationCreate = useCallback(
    async (annotation: Omit<Annotation, "id" | "created_at">) => {
      try {
        const newAnnotation = await apiService.createAnnotation(annotation);
        setAnnotations((prev) => [...prev, newAnnotation]);
      } catch (error) {
        console.error("Failed to create annotation:", error);
      }
    },
    []
  );

  const handleAnnotationUpdate = useCallback(
    async (id: string, updates: Partial<Annotation>) => {
      try {
        const updatedAnnotation = await apiService.updateAnnotation(
          id,
          updates
        );
        setAnnotations((prev) =>
          prev.map((ann) => (ann.id === id ? updatedAnnotation : ann))
        );
      } catch (error) {
        console.error("Failed to update annotation:", error);
      }
    },
    []
  );

  const handleAnnotationDelete = useCallback(
    async (id: string, filePath: string) => {
      try {
        await apiService.deleteAnnotation(id, filePath);
        setAnnotations((prev) => prev.filter((ann) => ann.id !== id));
      } catch (error) {
        console.error("Failed to delete annotation:", error);
      }
    },
    []
  );

  const handleAnnotationSelect = useCallback((annotation: Annotation) => {
    setSelectedAnnotation(annotation);
    // Jump to annotation time
    setCurrentTimeWindow({
      start: annotation.start_time,
      end: annotation.end_time || annotation.start_time + 30,
    });
  }, []);

  // DDA result handling
  const handleDDAResultSelect = useCallback((result: DDAResult) => {
    setSelectedDDAResult(result);
    setActiveTab("plots"); // Switch to plots tab
  }, []);

  // Utility function to determine channel group
  function getChannelGroup(
    channelName: string
  ): "frontal" | "central" | "parietal" | "occipital" | "temporal" | "other" {
    const name = channelName.toUpperCase();

    if (
      name.includes("FP") ||
      name.includes("F7") ||
      name.includes("F3") ||
      name.includes("FZ") ||
      name.includes("F4") ||
      name.includes("F8")
    ) {
      return "frontal";
    }
    if (name.includes("C3") || name.includes("CZ") || name.includes("C4")) {
      return "central";
    }
    if (
      name.includes("P3") ||
      name.includes("PZ") ||
      name.includes("P4") ||
      name.includes("P7") ||
      name.includes("P8")
    ) {
      return "parietal";
    }
    if (name.includes("O1") || name.includes("OZ") || name.includes("O2")) {
      return "occipital";
    }
    if (name.includes("T7") || name.includes("T8") || name.includes("TP")) {
      return "temporal";
    }
    return "other";
  }

  return (
    <div className={cn("h-screen bg-background flex flex-col", className)}>
      {/* Header */}
      <header className="flex-shrink-0 border-b bg-card/50 backdrop-blur">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Brain className="h-6 w-6 text-primary" />
              <div>
                <h1 className="text-xl font-bold">Dashboard</h1>
                <p className="text-sm text-muted-foreground">
                  {selectedFile ? selectedFile.file_name : "No file selected"}
                </p>
              </div>
            </div>

            {/* Interface Selector */}
            <InterfaceSelector currentInterface="web30" />
          </div>

          <div className="flex items-center gap-2">
            {selectedFile && (
              <>
                <Badge variant="outline">
                  {selectedChannels.length}/{selectedFile.channels.length}{" "}
                  channels
                </Badge>
                <Badge variant="outline">{selectedFile.sample_rate} Hz</Badge>
                <Badge variant="outline">
                  {Math.round(selectedFile.duration / 60)}min
                </Badge>
                {annotations.length > 0 && (
                  <Badge variant="secondary">
                    {annotations.length} annotations
                  </Badge>
                )}
                {ddaResults.length > 0 && (
                  <Badge variant="secondary">
                    {ddaResults.length} DDA results
                  </Badge>
                )}
              </>
            )}

            <Separator orientation="vertical" className="h-6" />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left Panel - File Management & Channel Selection */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={35}>
            <div className="h-full flex flex-col overflow-hidden">
              <Tabs defaultValue="files" className="h-full flex flex-col">
                <div className="flex-shrink-0 p-4 border-b">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="files">Files</TabsTrigger>
                    <TabsTrigger value="channels">Channels</TabsTrigger>
                    <TabsTrigger value="filters">Filters</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="files" className="flex-1 overflow-hidden">
                  <FileManager
                    selectedFile={selectedFile}
                    onFileSelect={handleFileSelect}
                    className="h-full"
                  />
                </TabsContent>

                <TabsContent
                  value="channels"
                  className="flex-1 overflow-hidden"
                >
                  {selectedFile ? (
                    <ChannelSelector
                      channels={eegChannels}
                      selectedChannels={selectedChannels}
                      onSelectionChange={handleChannelSelectionChange}
                      presets={channelPresets}
                      onPresetSave={handlePresetSave}
                      className="h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      <div className="text-center">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Select a file to configure channels</p>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="filters" className="flex-1 overflow-hidden">
                  {selectedFile ? (
                    <FilterPipeline
                      filters={filters}
                      onFiltersChange={setFilters}
                      sampleRate={selectedFile.sample_rate}
                      className="h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      <div className="text-center">
                        <Settings className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Select a file to configure filters</p>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Center Panel - Main Visualization */}
          <ResizablePanel defaultSize={50} minSize={40}>
            <div className="h-full">
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="h-full flex flex-col"
              >
                <div className="flex-shrink-0 p-4 border-b">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="eeg" disabled={!selectedFile}>
                      <Activity className="h-4 w-4 mr-1" />
                      EEG
                    </TabsTrigger>
                    <TabsTrigger value="annotations" disabled={!selectedFile}>
                      <FileText className="h-4 w-4 mr-1" />
                      Annotations
                    </TabsTrigger>
                    <TabsTrigger value="dda" disabled={!selectedFile}>
                      <BarChart3 className="h-4 w-4 mr-1" />
                      DDA
                    </TabsTrigger>
                    <TabsTrigger
                      value="plots"
                      disabled={!selectedFile && !selectedDDAResult}
                    >
                      <Image className="h-4 w-4 mr-1" />
                      Plots
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="eeg" className="flex-1 min-h-0 m-0">
                  {selectedFile && selectedChannels.length > 0 ? (
                    <EEGVisualization
                      file={selectedFile}
                      selectedChannels={selectedChannels}
                      annotations={annotations}
                      onAnnotationCreate={handleAnnotationCreate}
                      onAnnotationUpdate={handleAnnotationUpdate}
                      onAnnotationDelete={handleAnnotationDelete}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center space-y-2">
                        <Activity className="h-16 w-16 mx-auto opacity-50" />
                        <p className="text-lg font-medium">EEG Visualization</p>
                        <p className="text-sm">
                          Select a file and channels to view EEG data
                        </p>
                        {selectedFile && selectedChannels.length === 0 && (
                          <p className="text-xs text-amber-600 flex items-center gap-1 justify-center">
                            <AlertCircle className="h-3 w-3" />
                            No channels selected
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="annotations" className="flex-1 min-h-0 m-0">
                  <div className="h-full text-center flex items-center justify-center text-muted-foreground">
                    <div>
                      <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium">
                        Annotation Management
                      </p>
                      <p className="text-sm">
                        Use the annotation panel on the right to manage
                        annotations
                      </p>
                      <p className="text-xs mt-2">
                        Switch to EEG view to create annotations visually
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="dda" className="flex-1 min-h-0 m-0">
                  <div className="h-full text-center flex items-center justify-center text-muted-foreground">
                    <div>
                      <BarChart3 className="h-16 w-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium">DDA Analysis Hub</p>
                      <p className="text-sm">
                        Use the DDA panel on the right to run analyses
                      </p>
                      <p className="text-xs mt-2">
                        Results will appear here when completed
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="plots" className="flex-1 min-h-0 m-0">
                  {selectedDDAResult ? (
                    <PlotVisualization
                      ddaResult={selectedDDAResult}
                      plotType="dda_scaling"
                    />
                  ) : selectedFile ? (
                    <PlotVisualization
                      file={selectedFile}
                      selectedChannels={selectedChannels}
                      timeWindow={currentTimeWindow}
                      plotType="timeseries"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <Image className="h-16 w-16 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium">Plot Generation</p>
                        <p className="text-sm">
                          Select data or run DDA analysis to generate plots
                        </p>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right Panel - Analysis Tools */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={35}>
            <div className="h-full">
              <Tabs defaultValue="annotations" className="h-full flex flex-col">
                <div className="flex-shrink-0 p-4 border-b">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="annotations">Annotations</TabsTrigger>
                    <TabsTrigger value="dda">DDA Analysis</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="annotations" className="flex-1 min-h-0 m-0">
                  {selectedFile ? (
                    <AnnotationPanel
                      annotations={annotations}
                      onAnnotationCreate={handleAnnotationCreate}
                      onAnnotationUpdate={handleAnnotationUpdate}
                      onAnnotationDelete={handleAnnotationDelete}
                      onAnnotationSelect={handleAnnotationSelect}
                      filePath={selectedFile.file_path}
                      availableChannels={selectedFile.channels}
                      currentTime={currentTimeWindow.start}
                      selectedAnnotation={selectedAnnotation}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      <div className="text-center">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Select a file to manage annotations</p>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="dda" className="flex-1 min-h-0 m-0">
                  {selectedFile && selectedChannels.length > 0 ? (
                    <DDAAnalysisPanel
                      file={selectedFile}
                      selectedChannels={selectedChannels}
                      currentTimeWindow={currentTimeWindow}
                      onResultSelect={handleDDAResultSelect}
                      selectedResult={selectedDDAResult}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      <div className="text-center space-y-2">
                        <BarChart3 className="h-8 w-8 mx-auto opacity-50" />
                        <p>Select a file and channels</p>
                        <p className="text-sm">to run DDA analysis</p>
                        {selectedFile && selectedChannels.length === 0 && (
                          <p className="text-xs text-amber-600 flex items-center gap-1 justify-center">
                            <AlertCircle className="h-3 w-3" />
                            No channels selected
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Footer Status Bar */}
      <footer className="flex-shrink-0 border-t bg-card/50 backdrop-blur">
        <div className="flex items-center justify-between p-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            {selectedFile && (
              <>
                <span>File: {selectedFile.file_name}</span>
                <span>
                  Duration: {Math.round(selectedFile.duration / 60)}:
                  {String(Math.round(selectedFile.duration % 60)).padStart(
                    2,
                    "0"
                  )}
                </span>
                <span>
                  Channels: {selectedChannels.length}/
                  {selectedFile.channels.length}
                </span>
                <span>
                  Active Filters: {filters.filter((f) => f.enabled).length}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span>Ready</span>
            <CheckCircle className="h-3 w-3 text-green-600" />
          </div>
        </div>
      </footer>
    </div>
  );
}
