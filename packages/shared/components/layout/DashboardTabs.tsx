"use client";

import { useEffect, useState } from "react";
import { FileBrowserWidget } from "../dashboard/widgets/FileBrowserWidget";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ChevronLeft } from "lucide-react";
import { cn } from "../../lib/utils/misc";
import { apiRequest, ApiRequestOptions } from "../../lib/utils/request";
import { EdfConfigResponse } from "../../lib/schemas/edf";
import { useEDFPlot } from "../../contexts/EDFPlotContext";
import { ChannelSelectionDialog } from "../dialog/ChannelSelectionDialog";
import logger from "../../lib/utils/logger";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";

export function DashboardTabs() {
  const { data: session } = useUnifiedSessionData();
  const {
    selectedFilePath,
    setSelectedFilePath,
    updatePlotState,
  } = useEDFPlot();
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);

  const handleFileSelect = async (filePath: string) => {
    console.log('[DashboardTabs] handleFileSelect called with:', filePath);
    setPendingFilePath(filePath);
    setChannelDialogOpen(true);
    setSelectedFilePath(filePath);
    console.log('[DashboardTabs] channelDialogOpen should be true:', true);
    // Do not fetch channels or update state here; let the dialog handle it
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        // toggleFileBrowser(); // This function is removed from context
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []); // Removed toggleFileBrowser from dependency array

  // Load file configuration if we have a selected file path on mount
  // This handles the case where the component mounts with a persisted file selection
  useEffect(() => {
    if (
      selectedFilePath &&
      session?.accessToken
    ) {
      const loadFileConfig = async () => {
        try {
          const configRequestOptions: ApiRequestOptions & {
            responseType: "json";
          } = {
            url: `/api/config/edf?file_path=${encodeURIComponent(
              selectedFilePath
            )}`,
            method: "GET",
            token: session.accessToken!,
            responseType: "json",
            contentType: "application/json",
          };

          const fileCfgResponse = await apiRequest<EdfConfigResponse>(
            configRequestOptions
          );

          logger.info(
            "File config restored for persisted file:",
            fileCfgResponse
          );
          // setSelectedChannels(fileCfgResponse?.channels || []); // This line is removed
        } catch (error) {
          logger.error("Error loading config for persisted file:", error);
        }
      };

      loadFileConfig();
    }
  }, [
    selectedFilePath,
    session?.accessToken,
    // selectedChannels.length, // This line is removed
    // setSelectedChannels, // This line is removed
  ]);

  return (
    <div className="flex flex-row relative w-full h-full">
      <div
        className={cn(
          "h-full bg-background border-r z-30 shadow-lg transition-all duration-300 ease-in-out flex-shrink-0",
          // fileBrowserCollapsed ? "w-0 opacity-0 overflow-hidden" : "w-80 lg:w-96 opacity-100" // This line is removed
          "w-80 lg:w-96 opacity-100" // This line is removed
        )}
      >
        <div className="p-6 h-full overflow-auto">
          <FileBrowserWidget onFileSelect={handleFileSelect} />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-shrink-0 p-2 border-b bg-background/50">
          <Button
            variant="outline"
            size="sm"
            // onClick={toggleFileBrowser} // This function is removed from context
            className="h-8 shadow-sm"
          >
            {/* {fileBrowserCollapsed ? ( // This line is removed
              <>
                <ChevronRight className="h-4 w-4 mr-1" /> Show Files
              </>
            ) : ( // This line is removed
              <>
                <ChevronLeft className="h-4 w-4 mr-1" /> Hide Files
              </>
            )} */}
            {/* This button is now static, no toggle logic */}
            <ChevronLeft className="h-4 w-4 mr-1" /> Hide Files
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="p-6 sm:p-8 lg:p-12 xl:p-16 2xl:p-20">
            {selectedFilePath ? (
              <div className="space-y-6">
                {/* DDAForm removed */}
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-[400px]">
                <Card className="mx-auto max-w-2xl">
                  <CardContent className="pt-12 pb-12 px-8">
                    <p className="text-center text-muted-foreground text-lg leading-relaxed">
                      Please select a file from the sidebar to analyze data.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
            {/* Channel Selection Dialog */}
            {pendingFilePath && (
              <ChannelSelectionDialog
                open={channelDialogOpen}
                onOpenChange={open => {
                  setChannelDialogOpen(open);
                  if (!open) setPendingFilePath(null);
                }}
                filePath={pendingFilePath}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
