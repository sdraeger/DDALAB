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
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
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

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "installed" | "browse")}
        >
          <TabsList>
            <TabsTrigger value="installed" className="gap-1.5">
              <Puzzle className="h-3.5 w-3.5" />
              Installed
            </TabsTrigger>
            <TabsTrigger value="browse" className="gap-1.5">
              <Store className="h-3.5 w-3.5" />
              Browse Registry
            </TabsTrigger>
          </TabsList>

          <TabsContent value="installed" className="mt-4">
            <div className="flex gap-6">
              {/* Left sidebar: installed list */}
              <div className="w-56 shrink-0 border rounded-lg overflow-hidden h-[calc(100vh-16rem)]">
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
                  <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                    Select a plugin to view details
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="browse" className="mt-4">
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
