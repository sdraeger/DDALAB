"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { Footer } from "@/components/layout/Footer";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ThemeSyncProvider } from "@/components/providers/ThemeSyncProvider";
import { PopOutManager } from "@/components/popout/PopOutManager";
import { LoadedFilesManager } from "@/components/dashboard/LoadedFilesManager";
import {
  useAppDispatch,
  useHeaderVisible,
  useFooterVisible,
  useSidebarCollapsed,
  useWidgets,
} from "@/store/hooks";
import { useLayoutPersistence } from "@/hooks/useLayoutPersistence";
import { setFileData } from "@/store/slices/plotSlice";
import { Save, RefreshCw, Trash2 } from "lucide-react";

export default function DashboardPage() {
  const dispatch = useAppDispatch();
  const sidebarCollapsed = useSidebarCollapsed();
  const headerVisible = useHeaderVisible();
  const footerVisible = useFooterVisible();
  const widgets = useWidgets();

  // Use layout persistence hook
  const {
    addWidget,
    removeWidget,
    updateWidget,
    saveLayout,
    loadLayout,
    clearLayout,
    isInitialized,
  } = useLayoutPersistence();

  // Listen for file loads and update store
  useEffect(() => {
    const handleFileLoad = (event: CustomEvent) => {
      const { filePath, selectedChannels, metadata, edfData } = event.detail;
      
      // Update the store with the new file data
      dispatch(setFileData({
        filePath,
        plotData: {
          metadata: metadata || null,
          edfData: edfData || null,
          selectedChannels: selectedChannels || [],
          ddaResults: null
        }
      }));
    };

    window.addEventListener('dda:edf-loaded', handleFileLoad as EventListener);
    
    return () => {
      window.removeEventListener('dda:edf-loaded', handleFileLoad as EventListener);
    };
  }, [dispatch]);

  // No sample widgets by default - user will add them manually
  useEffect(() => {
    if (isInitialized && widgets.length === 0) {
      console.log("No saved layout found, showing hint to add widgets");
    }
  }, [isInitialized, widgets.length]);

  const handleManualSave = async () => {
    try {
      await saveLayout();
      console.log("Layout saved successfully");
    } catch (error) {
      console.error("Failed to save layout:", error);
    }
  };

  const handleManualLoad = async () => {
    try {
      await loadLayout();
      console.log("Layout loaded successfully");
    } catch (error) {
      console.error("Failed to load layout:", error);
    }
  };

  const handleClearLayout = async () => {
    try {
      await clearLayout();
      console.log("Layout cleared successfully");
    } catch (error) {
      console.error("Failed to clear layout:", error);
    }
  };


  return (
    <AuthProvider>
      <ThemeSyncProvider>
        <PopOutManager />
        <div className="min-h-screen w-full bg-background">
          <div className="flex h-screen">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0">
              {headerVisible && <Header />}
              <main className="flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="p-6 space-y-6">
                  {/* Layout Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleManualSave}
                        className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md"
                      >
                        <Save className="h-3 w-3" />
                        Save Layout
                      </button>
                      <button
                        onClick={handleManualLoad}
                        className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Reload
                      </button>
                      <button
                        onClick={handleClearLayout}
                        className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                        Clear
                      </button>
                    </div>

                    {/* Loaded Files Manager */}
                    <LoadedFilesManager />
                  </div>

                  {/* Debug Info */}
                  <div className="text-xs text-muted-foreground">
                    Widgets: {widgets.length} | Initialized:{" "}
                    {isInitialized ? "Yes" : "No"}
                  </div>
                </div>
                <div className="flex-1 min-h-0 relative">
                  <DashboardGrid isInitialized={isInitialized} />
                </div>
              </main>
              {footerVisible && <Footer />}
            </div>
          </div>
        </div>
      </ThemeSyncProvider>
    </AuthProvider>
  );
}
