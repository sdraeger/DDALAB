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
import { useLoadingManager } from "../../hooks/useLoadingManager";
import { LoadingOverlay } from "../ui/loading-overlay";

export function DDAPlot(props: DDAPlotProps) {
  const { filePath, Q, selectedChannels, artifactInfo, noBorder = false } = props;

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
    isDDArtifact,
    ddaQMatrix,
    actualEDFFilePath,
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

  // Use Q matrix from artifact if available, otherwise fall back to props
  const effectiveQ = ddaQMatrix || Q;

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

  // Initialize loading manager for heatmap processing
  const loadingManager = useLoadingManager();

  const plotContent = (
    <>
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
        hasHeatmapData={effectiveQ && Array.isArray(effectiveQ) && effectiveQ.length > 0}
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

      <div
        ref={chartAreaRef}
        className={noBorder ? "flex-grow relative" : "flex-grow p-0 relative"}
      >
        {!noBorder && (
          <div className="border-b px-4 py-2 bg-muted/30">
            <h2 className="text-lg font-semibold">EEG Time Series Plot</h2>
          </div>
        )}
        {manualErrorMessage && !loading && (
          <Alert variant="destructive" className="m-4">
            <AlertDescription>{manualErrorMessage}</AlertDescription>
          </Alert>
        )}

        <div
          className={`w-full flex flex-row items-stretch justify-center relative gap-4`}
        >
          <ResizableEEGPlot
            filePath={actualEDFFilePath || filePath}
            variant="default"
            className={(showHeatmap || isHeatmapProcessing) && effectiveQ ? "w-1/2" : "w-full"}
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

          {(showHeatmap || isHeatmapProcessing) && effectiveQ && (
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
                <LoadingOverlay
                  show={true}
                  message="Processing DDA Heatmap..."
                  type="dda-processing"
                  variant="modal"
                  size="lg"
                />
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
      </div>

      <AnnotationEditor
        filePath={actualEDFFilePath || filePath}
        currentSample={currentSample}
        sampleRate={plotState.sampleRate}
        initialAnnotations={annotations}
        onAnnotationsChange={setAnnotations}
        onAnnotationUpdate={updateAnnotation}
        onAnnotationSelect={handleAnnotationSelect}
      />

      {!noBorder && (
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
      )}

      {noBorder && (
        <div className="mt-4 border rounded-lg p-4">
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
        </div>
      )}
    </>
  );

  return noBorder ? (
    <div className="h-full flex flex-col relative">
      {plotContent}
    </div>
  ) : (
    <Card className="h-full flex flex-col relative">
      <CardContent className="flex-grow p-0 relative">
        {plotContent}
      </CardContent>
    </Card>
  );
}
