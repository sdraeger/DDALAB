"use client";

import { useState, useEffect } from "react";
import { FileBrowser } from "../files/file-browser";
import { DDAForm } from "../form/dda-form";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { useSession } from "next-auth/react";
import { apiRequest, ApiRequestOptions } from "../../lib/utils/request";
import { EdfConfigResponse } from "../../lib/schemas/edf";

export function DashboardTabs() {
  const { data: session } = useSession();
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileBrowserCollapsed, setFileBrowserCollapsed] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  const handleFileSelect = async (filePath: string) => {
    setSelectedFilePath(filePath);
    // Collapse the file browser when a file is selected
    setFileBrowserCollapsed(true);

    const token = session?.accessToken;
    if (!token) throw new Error("No token found in session");

    const configRequestOptions: ApiRequestOptions & { responseType: "json" } = {
      url: `/api/config/edf?file_path=${encodeURIComponent(filePath)}`,
      method: "GET",
      token,
      responseType: "json",
      contentType: "application/json",
    };

    const fileCfgResponse = await apiRequest<EdfConfigResponse>(
      configRequestOptions
    );

    console.log("File config:", fileCfgResponse);

    setSelectedChannels(fileCfgResponse?.channels || []);
  };

  const toggleFileBrowser = () => {
    setFileBrowserCollapsed(!fileBrowserCollapsed);
  };

  // Handle keyboard shortcuts for toggling the sidebar
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Toggle sidebar on Ctrl+B
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        toggleFileBrowser();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [fileBrowserCollapsed]);

  return (
    <div className="flex flex-row relative">
      {/* File Browser Sidebar */}
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

      {/* Toggle Button */}
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

      {/* Main Content Area */}
      <div
        className={cn(
          "flex-grow transition-all duration-300 ease-in-out w-full",
          fileBrowserCollapsed ? "ml-0" : "ml-[700px]"
        )}
      >
        <div className="w-full px-4 md:px-6">
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
                  Please select a file from the sidebar to start a DDA analysis
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
