"use client";

import { useCallback, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/store/appStore";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Puzzle, Store } from "lucide-react";
import { PluginInstalledList } from "./PluginInstalledList";
import { PluginDetailView } from "./PluginDetailView";
import { PluginBrowser } from "./PluginBrowser";
import { PluginRunDialog } from "./PluginRunDialog";
import { useInstalledPlugin } from "@/hooks/usePlugins";

export function PluginManagementPanel() {
  const { selectedPluginId, currentAnalysisId } = useAppStore(
    useShallow((s) => ({
      selectedPluginId: s.plugins.selectedPluginId,
      currentAnalysisId: s.dda.currentAnalysis?.id ?? null,
    })),
  );

  const { data: selectedPlugin } = useInstalledPlugin(selectedPluginId);

  const [activeTab, setActiveTab] = useState<"installed" | "browse">(
    "installed",
  );
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runPluginId, setRunPluginId] = useState<string | null>(null);

  const handleRunPlugin = useCallback((pluginId: string) => {
    setRunPluginId(pluginId);
    setRunDialogOpen(true);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 pb-2 space-y-4 w-full flex-shrink-0">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Puzzle className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">Plugins</h2>
          </div>
          <p className="text-sm text-muted-foreground ml-9">
            Install and manage WASM analysis plugins
          </p>
        </div>

        <Separator />
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 w-full">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "installed" | "browse")}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="flex-shrink-0">
            <TabsTrigger value="installed" className="gap-1.5">
              <Puzzle className="h-3.5 w-3.5" />
              Installed
            </TabsTrigger>
            <TabsTrigger value="browse" className="gap-1.5">
              <Store className="h-3.5 w-3.5" />
              Browse Registry
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="installed"
            className="mt-4 flex-1 min-h-0 data-[state=active]:flex"
          >
            <div className="flex gap-6 flex-1 min-h-0">
              {/* Left sidebar: installed list */}
              <div className="w-56 shrink-0 border rounded-lg overflow-hidden">
                <PluginInstalledList />
              </div>

              {/* Right: detail view */}
              <div className="flex-1 min-w-0 border rounded-lg overflow-hidden">
                {selectedPluginId ? (
                  <PluginDetailView
                    pluginId={selectedPluginId}
                    onRunPlugin={handleRunPlugin}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select a plugin to view details
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value="browse"
            className="mt-4 flex-1 min-h-0 data-[state=active]:flex"
          >
            <PluginBrowser />
          </TabsContent>
        </Tabs>
      </div>

      <PluginRunDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        pluginId={runPluginId}
        pluginName={selectedPlugin?.name ?? "Plugin"}
        analysisId={currentAnalysisId}
      />
    </div>
  );
}
