"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileBrowser } from "@/components/file-browser";
import { DDAForm } from "@/components/dda-form";
import { TaskStatus } from "@/components/task-status";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import logger from "@/lib/utils/logger";

export function DashboardTabs() {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("eeg_files");
  const [fileBrowserCollapsed, setFileBrowserCollapsed] = useState(false);

  const handleFileSelect = (filePath: string) => {
    setSelectedFilePath(filePath);
    // Optionally collapse file browser when a file is selected on mobile
    if (window.innerWidth < 768) {
      setFileBrowserCollapsed(true);
    }
  };

  const handleTaskSubmitted = (taskId: string) => {
    // setActiveTaskId(taskId);
    // setActiveTab("tasks");
  };

  const handleTaskComplete = (results: any) => {
    // You could do something with the results here
    logger.info("Task completed with results:", results);
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
    <div className="mx-auto w-[95%] max-w-[2400px]">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 mb-8">
          <TabsTrigger value="eeg_files">EEG Files</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="eeg_files" className="space-y-4">
          <div className="flex flex-row relative">
            {/* File Browser Sidebar */}
            <div
              className={cn(
                "h-[calc(100vh-180px)] fixed left-0 top-[140px] bottom-0 bg-background border-r z-30 shadow-lg transition-all duration-300 ease-in-out",
                fileBrowserCollapsed
                  ? "w-0 -ml-4 opacity-0"
                  : "w-[700px] opacity-100"
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
              <div className="px-6">
                {selectedFilePath ? (
                  <DDAForm
                    filePath={selectedFilePath}
                    channelList={selectedChannels}
                    onTaskSubmitted={handleTaskSubmitted}
                  />
                ) : (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-center text-muted-foreground">
                        Please select a file from the sidebar to start a DDA
                        analysis
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          {activeTaskId ? (
            <TaskStatus taskId={activeTaskId} onComplete={handleTaskComplete} />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  No active tasks. Submit a DDA task to see task status here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
