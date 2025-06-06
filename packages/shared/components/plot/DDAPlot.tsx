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

export function DDAPlot(props: DDAPlotProps) {
  const { filePath, Q, selectedChannels } = props;

  const { data: session } = useSession();

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

  return (
    <Card className="h-full flex flex-col relative">
      <PlotControls
        onPrevChunk={handlePrevChunk}
        onNextChunk={handleNextChunk}
        canGoPrev={plotState.currentChunkNumber > 1}
        canGoNext={plotState.currentChunkNumber < plotState.totalChunks}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleReset}
        onShowSettings={() => setShowZoomSettings(true)}
        isLoading={loading}
        currentChunkNumber={plotState.currentChunkNumber}
        totalChunks={plotState.totalChunks}
        showHeatmap={showHeatmap}
        onToggleHeatmap={toggleHeatmap}
        isHeatmapProcessing={isHeatmapProcessing}
        onChunkSelect={handleChunkSelect}
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
          className={`w-full flex flex-col md:flex-row items-stretch justify-center relative gap-4`}
        >
          <ResizableEEGPlot
            filePath={filePath}
            variant="default"
            className={showHeatmap && Q ? "md:w-1/2 w-full" : "w-full"}
          >
            {plotState.edfData?.channels?.length ? (
              (() => {
                // Filter annotations to only include those within the current chunk
                const chunkStart = plotState.chunkStart || 0;
                const chunkSize = plotState.edfData?.samplesPerChannel || 0;
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

          {showHeatmap && Q && (
            <div className="md:w-1/2 w-full flex flex-col items-center justify-center relative border-l md:border-l border-t md:border-t-0 border-border">
              <div className="w-full flex justify-end p-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleHeatmap()}
                >
                  Close Heatmap
                </Button>
              </div>
              <DDAHeatmap
                data={ddaHeatmapData}
                onClose={() => toggleHeatmap()}
              />
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
