"use client";

import { useEffect } from "react";
import { FileBrowser } from "../files/FileBrowser";
import { DDAForm } from "../form/DDAForm";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils/misc";
import { apiRequest, ApiRequestOptions } from "../../lib/utils/request";
import { EdfConfigResponse } from "../../lib/schemas/edf";
import { useDashboardState } from "../../contexts/DashboardStateContext";
import logger from "../../lib/utils/logger";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";

export function DashboardTabs() {
  const { data: session } = useUnifiedSessionData();
  const {
    selectedFilePath,
    fileBrowserCollapsed,
    selectedChannels,
    setSelectedChannels,
    toggleFileBrowser,
    handleFileSelect: handleFileSelectFromContext,
  } = useDashboardState();

  const handleFileSelect = async (filePath: string) => {
    // Use the context's file select handler first
    handleFileSelectFromContext(filePath);

    const token = session?.accessToken;
    if (!token) {
      logger.error("No token found in session");
      return;
    }

    try {
      const configRequestOptions: ApiRequestOptions & { responseType: "json" } =
      {
        url: `/api/config/edf?file_path=${encodeURIComponent(filePath)}`,
        method: "GET",
        token,
        responseType: "json",
        contentType: "application/json",
      };

      const fileCfgResponse = await apiRequest<EdfConfigResponse>(
        configRequestOptions
      );

      logger.info("File config loaded:", fileCfgResponse);

      // Update selected channels from the file config
      setSelectedChannels(fileCfgResponse?.channels || []);
    } catch (error) {
      logger.error("Error loading file config:", error);
      // Still update the selected file path even if config fails
      setSelectedChannels([]);
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        toggleFileBrowser();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [toggleFileBrowser]);

  // Load file configuration if we have a selected file path on mount
  // This handles the case where the component mounts with a persisted file selection
  useEffect(() => {
    if (
      selectedFilePath &&
      session?.accessToken &&
      selectedChannels.length === 0
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
          setSelectedChannels(fileCfgResponse?.channels || []);
        } catch (error) {
          logger.error("Error loading config for persisted file:", error);
        }
      };

      loadFileConfig();
    }
  }, [
    selectedFilePath,
    session?.accessToken,
    selectedChannels.length,
    setSelectedChannels,
  ]);

  return (
    <div className="flex flex-row relative w-full h-full">
      <div
        className={cn(
          "h-full bg-background border-r z-30 shadow-lg transition-all duration-300 ease-in-out flex-shrink-0",
          fileBrowserCollapsed ? "w-0 opacity-0 overflow-hidden" : "w-80 lg:w-96 opacity-100"
        )}
      >
        <div className="p-6 h-full overflow-auto">
          <FileBrowser onFileSelect={handleFileSelect} />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-shrink-0 p-2 border-b bg-background/50">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFileBrowser}
            className="h-8 shadow-sm"
          >
            {fileBrowserCollapsed ? (
              <>
                <ChevronRight className="h-4 w-4 mr-1" /> Show Files
              </>
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-1" /> Hide Files
              </>
            )}
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="p-6 sm:p-8 lg:p-12 xl:p-16 2xl:p-20">
            {selectedFilePath ? (
              <div className="space-y-6">
                <DDAForm
                  filePath={selectedFilePath}
                  selectedChannels={selectedChannels}
                  setSelectedChannels={setSelectedChannels}
                />
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
          </div>
        </div>
      </div>
    </div>
  );
}
