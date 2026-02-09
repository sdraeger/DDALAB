"use client";

import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/store/appStore";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Puzzle, Package } from "lucide-react";
import { useInstalledPlugins, useTogglePlugin } from "@/hooks/usePlugins";
import { cn } from "@/lib/utils";

export function PluginInstalledList() {
  const { selectedPluginId, setSelectedPlugin } = useAppStore(
    useShallow((s) => ({
      selectedPluginId: s.plugins.selectedPluginId,
      setSelectedPlugin: s.setSelectedPlugin,
    })),
  );

  const { data: plugins } = useInstalledPlugins();
  const toggleMutation = useTogglePlugin();

  if (!plugins || plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center h-full">
        <Package className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
        <p className="text-sm text-muted-foreground">No plugins installed</p>
        <p className="text-xs text-muted-foreground mt-1">
          Browse the registry to find plugins
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {plugins.map((plugin) => (
          <button
            key={plugin.id}
            onClick={() => setSelectedPlugin(plugin.id)}
            className={cn(
              "w-full text-left p-2.5 rounded-md transition-colors",
              "hover:bg-muted/50",
              selectedPluginId === plugin.id && "bg-muted",
            )}
          >
            <div className="flex items-center gap-2">
              <Puzzle className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate flex-1">
                {plugin.name}
              </span>
              <Switch
                checked={plugin.enabled}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({
                    pluginId: plugin.id,
                    enabled: checked,
                  })
                }
                onClick={(e) => e.stopPropagation()}
                className="shrink-0"
              />
            </div>
            <div className="flex items-center gap-1.5 mt-1 ml-6">
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                v{plugin.version}
              </Badge>
              <span className="text-[10px] text-muted-foreground truncate">
                {plugin.category}
              </span>
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
