"use client";

import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Badge } from "./badge";
import { RefreshCw, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { useDashboardState } from "../../contexts/DashboardStateContext";
import { useToast } from "./use-toast";
import { useSelector, useDispatch } from "react-redux";
import {
  selectCurrentFilePath,
  selectCurrentPlotState,
  clearAllPlots,
} from "../../store/slices/plotSlice";
import { usePersistentPlots } from "../../contexts/PersistentPlotsContext";
import { useEDFPlot } from "../../contexts/EDFPlotContext";
import { cacheManager } from "../../lib/utils/cache";
import { useState } from "react";

export function DashboardStateManager() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Redux state
  const selectedFilePath = useSelector(selectCurrentFilePath);
  const currentPlotState = useSelector(selectCurrentPlotState);
  const selectedChannels = currentPlotState?.selectedChannels || [];
  // File browser collapsed state (still from context if not in Redux)
  const { fileBrowserCollapsed, clearDashboardState } = useDashboardState();
  const { toast } = useToast();
  const dispatch = useDispatch();
  const { clearAllPlots: clearPersistentPlots } = usePersistentPlots();
  const { clearAllPlotStates } = useEDFPlot();

  const hasState = selectedFilePath || selectedChannels.length > 0 || (currentPlotState && currentPlotState.edfData);

  const handleClearState = () => {
    // Clear all state: context, Redux plots, persistent plots, EDF plot states, and caches
    clearDashboardState();
    dispatch(clearAllPlots());
    clearPersistentPlots();
    clearAllPlotStates();
    cacheManager.clearAllCache();
    toast({
      title: "Dashboard State Cleared",
      description: "Dashboard has been reset to initial state.",
    });
  };

  const toggleCollapsed = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Dashboard State</CardTitle>
            <CardDescription>
              Current dashboard state and preferences
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapsed}
            className="h-8 w-8 p-0"
          >
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm">Selected File:</span>
              <Badge variant={selectedFilePath ? "default" : "secondary"}>
                {selectedFilePath ? "Set" : "None"}
              </Badge>
            </div>
            {selectedFilePath && (
              <div className="text-xs text-muted-foreground truncate">
                {selectedFilePath}
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-sm">File Browser:</span>
              <Badge variant="outline" className="gap-1">
                {fileBrowserCollapsed ? (
                  <>
                    <EyeOff className="h-3 w-3" />
                    Hidden
                  </>
                ) : (
                  <>
                    <Eye className="h-3 w-3" />
                    Visible
                  </>
                )}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">Selected Channels:</span>
              <Badge variant="secondary">{selectedChannels.length}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">Plot State:</span>
              <Badge variant={currentPlotState ? (currentPlotState.isLoading ? "secondary" : (currentPlotState.error ? "destructive" : "default")) : "secondary"}>
                {currentPlotState
                  ? currentPlotState.isLoading
                    ? "Loading"
                    : currentPlotState.error
                      ? "Error"
                      : "Loaded"
                  : "No plot loaded"}
              </Badge>
            </div>
            {currentPlotState && (
              <>
                {currentPlotState.error && (
                  <div className="text-xs text-destructive truncate">{currentPlotState.error}</div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm">Chunk:</span>
                  <span className="text-xs">{currentPlotState.currentChunkNumber} / {currentPlotState.totalChunks}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Time Window:</span>
                  <span className="text-xs">{currentPlotState.timeWindow[0]}s - {currentPlotState.timeWindow[1]}s</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Zoom:</span>
                  <span className="text-xs">{currentPlotState.zoomLevel}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Annotations:</span>
                  <span className="text-xs">{currentPlotState.annotations ? currentPlotState.annotations.length : 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">DDA Results:</span>
                  <Badge variant={currentPlotState.ddaResults ? "default" : "secondary"}>
                    {currentPlotState.ddaResults ? "Available" : "None"}
                  </Badge>
                </div>
              </>
            )}
          </div>
          <div className="pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearState}
              disabled={!hasState}
              className="gap-2 w-full"
            >
              <RefreshCw className="h-4 w-4" />
              Reset Dashboard State
            </Button>
            {!hasState && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                No dashboard state to clear
              </p>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <p>• Dashboard state persists for 2 hours</p>
            <p>• Includes selected file and sidebar preferences</p>
            <p>• Automatically cleared when expired</p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
