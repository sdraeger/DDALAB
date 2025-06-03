"use client";

import { useEffect } from "react";
import { FileBrowser } from "../files/FileBrowser";
import { DDAForm } from "../form/DDAForm";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils/misc";
import { useSession } from "next-auth/react";
import { apiRequest, ApiRequestOptions } from "../../lib/utils/request";
import { EdfConfigResponse } from "../../lib/schemas/edf";
import { useDashboardState } from "../../contexts/DashboardStateContext";
import logger from "../../lib/utils/logger";

export function DashboardTabs() {
  const { data: session } = useSession();
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
    <div className="flex flex-row relative">
      <div
        className={cn(
          "h-[calc(100vh-180px)] fixed left-0 top-[140px] bottom-0 bg-background border-r z-30 shadow-lg transition-all duration-300 ease-in-out",
          fileBrowserCollapsed ? "w-0 -ml-4 opacity-0" : "w-[700px] opacity-100"
        )}
      >
        <div className="p-4 h-full">
          <FileBrowser onFileSelect={handleFileSelect} />
        </div>
      </div>

      <div
        className={cn(
          "fixed top-[140px] z-40 transition-all duration-300",
          fileBrowserCollapsed ? "left-0" : "left-[700px]"
        )}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={toggleFileBrowser}
          className="h-8 rounded-l-none border-l-0 shadow-md"
        >
          {fileBrowserCollapsed ? (
            <>
              <ChevronRight className="h-4 w-4 mr-1" /> Files
            </>
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div
        className={cn(
          "flex-grow transition-all duration-300 ease-in-out w-full",
          fileBrowserCollapsed ? "ml-0" : "ml-[700px]"
        )}
      >
        <div className="w-full px-4 sm:px-6 lg:px-8">
          {selectedFilePath ? (
            <DDAForm
              filePath={selectedFilePath}
              selectedChannels={selectedChannels}
              setSelectedChannels={setSelectedChannels}
            />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  Please select a file from the sidebar to analyze data.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
