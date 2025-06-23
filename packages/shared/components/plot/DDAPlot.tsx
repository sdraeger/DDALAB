"use client";

import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Alert, AlertDescription } from "../ui/alert";
import { Settings } from "lucide-react";
import { EEGChart } from "./EEGChart";
import { DDAHeatmap } from "./DDAHeatmap";
import { PlotControls } from "./PlotControls";
import { ChannelSelectorUI } from "../ui/ChannelSelectorUI";
import { AnnotationEditor } from "../ui/annotation-editor";
import { ResizableEEGPlot } from "../ui/ResizableEEGPlot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { EEGZoomSettings } from "../settings/EEGZoomSettings";
import { useDDAPlot } from "../../hooks/useDDAPlot";
import { useSession } from "next-auth/react";
import type { DDAPlotProps } from "../../types/DDAPlotProps";
import { Loader2 } from "lucide-react";

export function DDAPlot(props: DDAPlotProps) {
  const { filePath, Q, selectedChannels, artifactInfo } = props;

  const { data: session } = useSession();

  // DDA Plot hook - automatically shows heatmap when Q matrix is provided
  const {
    plotState,
    loading,
    error,
    manualErrorMessage,
    showHeatmap,
    ddaHeatmapData,
    isHeatmapProcessing,
    showZoomSettings,
    chartAreaRef,
    availableChannels,
    currentSample,
    timeWindow,
    zoomLevel,
    editMode,
    annotations,
    currentChunkNumber,
    totalChunks,
    handlePrevChunk,
    handleNextChunk,
    handleChunkSelect,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    toggleChannel,
    handleChartClick,
    handleAnnotationSelect,
    toggleHeatmap,
    handleSelectAllChannels,
    handleClearAllChannels,
    handleSelectChannels,
    setShowZoomSettings,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    setAnnotations,
    handleTimeWindowChange,
  } = useDDAPlot(props);

  const QuickZoomSettings = ({ onClose }: { onClose: () => void }) => (
    <div className="p-4">
      <EEGZoomSettings />
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );

  // Elegant loading animation component
  const HeatmapLoadingAnimation = ({ Q }: { Q?: any[][] }) => {
    const matrixRows = Array.isArray(Q) ? Q.length : 0;
    const matrixCols = Array.isArray(Q) && Q[0] ? Q[0].length : 0;

    return (
      <div
        className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }} // Fallback
      >
        <div className="flex flex-col items-center space-y-6 p-8">
          {/* Main spinner - simplified for reliability */}
          <div className="relative">
            <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <div className="absolute inset-0 w-16 h-16 border-4 border-blue-100 rounded-full opacity-20"></div>
          </div>

          {/* Processing text */}
          <div className="text-center space-y-3">
            <h3 className="text-xl font-semibold text-blue-600">
              Processing DDA Heatmap
            </h3>
            <p className="text-sm text-gray-600 max-w-md">
              Analyzing {matrixRows} × {matrixCols} matrix for differential drive analysis
            </p>
          </div>

          {/* Simple progress bar */}
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Computing correlations</span>
              <span>Please wait...</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full animate-pulse"></div>
            </div>
          </div>

          {/* Status indicator */}
          <div className="flex items-center space-x-2 text-xs text-gray-500">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span>Processing matrix data...</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="h-full flex flex-col relative">
      <PlotControls
        onPrevChunk={handlePrevChunk}
        onNextChunk={handleNextChunk}
        canGoPrev={currentChunkNumber > 1}
        canGoNext={currentChunkNumber < totalChunks}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleReset}
        onShowSettings={() => setShowZoomSettings(true)}
        isLoading={loading}
        currentChunkNumber={currentChunkNumber}
        totalChunks={totalChunks}
        showHeatmap={showHeatmap}
        onToggleHeatmap={toggleHeatmap}
        isHeatmapProcessing={isHeatmapProcessing}
        onChunkSelect={handleChunkSelect}
        hasHeatmapData={Q && Array.isArray(Q) && Q.length > 0}
        artifactInfo={artifactInfo}
      />

      {showZoomSettings && (
        <Dialog open={showZoomSettings} onOpenChange={setShowZoomSettings}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowZoomSettings(true)}
              className="flex items-center gap-1"
            >
              <Settings className="h-4 w-4" />
              <span>Zoom Settings</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Zoom Settings</DialogTitle>
              <DialogDescription>
                Customize how the EEG chart responds to mouse wheel zooming
              </DialogDescription>
            </DialogHeader>
            <QuickZoomSettings onClose={() => setShowZoomSettings(false)} />
          </DialogContent>
        </Dialog>
      )}

      <CardContent ref={chartAreaRef} className="flex-grow p-0 relative">
        <div className="border-b px-4 py-2 bg-muted/30">
          <h2 className="text-lg font-semibold">EEG Time Series Plot</h2>
        </div>
        {manualErrorMessage && !loading && (
          <Alert variant="destructive" className="m-4">
            <AlertDescription>{manualErrorMessage}</AlertDescription>
          </Alert>
        )}

        <div
          className={`w-full flex flex-row items-stretch justify-center relative gap-4`}
        >
          <ResizableEEGPlot
            filePath={filePath}
            variant="default"
            className={(showHeatmap || isHeatmapProcessing) && Q ? "w-1/2" : "w-full"}
          >
            {plotState.edfData?.data?.length ? (
              (() => {
                // Filter annotations to only include those within the current chunk
                const chunkStart = plotState.chunkStart || 0;
                const chunkSize = plotState.edfData?.chunkSize || 0;
                const chunkEndSample = chunkStart + chunkSize;

                const chunkAnnotations = annotations.filter(
                  (annotation) =>
                    annotation.startTime >= chunkStart &&
                    annotation.startTime < chunkEndSample
                );

                return (
                  <EEGChart
                    eegData={plotState.edfData}
                    timeWindow={timeWindow}
                    selectedChannels={selectedChannels}
                    annotations={chunkAnnotations}
                    onAnnotationSelect={handleAnnotationSelect}
                    onChartClick={handleChartClick}
                    zoomLevel={zoomLevel}
                    onTimeWindowChange={handleTimeWindowChange}
                    absoluteTimeWindow={plotState.absoluteTimeWindow}
                    editMode={editMode}
                    onAnnotationAdd={addAnnotation}
                    onAnnotationDelete={deleteAnnotation}
                    filePath={filePath}
                    height="100%"
                    customZoomFactor={
                      session?.user?.preferences?.eegZoomFactor || 0.05
                    }
                  />
                );
              })()
            ) : (
              <div className="text-muted-foreground text-center w-full flex items-center justify-center h-full">
                {loading
                  ? "Loading EEG data..."
                  : manualErrorMessage ||
                  "No data to display or plot not loaded."}
              </div>
            )}
          </ResizableEEGPlot>

          {(showHeatmap || isHeatmapProcessing) && Q && (
            <div className="w-1/2 flex flex-col relative border-l border-border">
              {/* Header with optional close button */}
              <div className="w-full flex justify-between items-center p-3 border-b bg-muted/30">
                <h3 className="text-sm font-medium">DDA Heatmap</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleHeatmap()}
                  className="h-6 w-6 p-0"
                >
                  ×
                </Button>
              </div>

              {/* Loading overlay */}
              {isHeatmapProcessing && (
                <HeatmapLoadingAnimation Q={Q} />
              )}

              {/* Heatmap content */}
              <div className="flex-1 relative">
                {showHeatmap && !isHeatmapProcessing && (
                  <div className="animate-in fade-in-50 duration-500">
                    <DDAHeatmap
                      data={ddaHeatmapData}
                      onClose={() => toggleHeatmap()}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>

      <AnnotationEditor
        filePath={filePath}
        currentSample={currentSample}
        sampleRate={plotState.sampleRate}
        initialAnnotations={annotations}
        onAnnotationsChange={setAnnotations}
        onAnnotationUpdate={updateAnnotation}
        onAnnotationSelect={handleAnnotationSelect}
      />
      <Card className="mt-4">
        <CardContent className="p-4">
          <ChannelSelectorUI
            availableChannels={availableChannels}
            selectedChannels={selectedChannels}
            onToggleChannel={toggleChannel}
            onSelectAllChannels={handleSelectAllChannels}
            onClearAllChannels={handleClearAllChannels}
            onSelectChannels={handleSelectChannels}
            isLoading={loading && availableChannels.length === 0}
            error={error && availableChannels.length === 0 ? error : null}
          />
        </CardContent>
      </Card>
    </Card>
  );
}
