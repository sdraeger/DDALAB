"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/store/appStore";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, RefreshCw } from "lucide-react";
import {
  usePluginRegistry,
  useInstalledPlugins,
  useInstallPlugin,
} from "@/hooks/usePlugins";
import { PluginCard } from "./PluginCard";
import { PluginPermissionReview } from "./PluginPermissionReview";
import type { RegistryEntry } from "@/store/slices/pluginSlice";

const DEFAULT_REGISTRY_URL = "https://plugins.ddalab.org";

const CATEGORIES = [
  "all",
  "analysis",
  "preprocessing",
  "visualization",
  "export",
] as const;

export function PluginBrowser() {
  const { setSelectedPlugin } = useAppStore(
    useShallow((s) => ({
      setSelectedPlugin: s.setSelectedPlugin,
    })),
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [reviewPlugin, setReviewPlugin] = useState<RegistryEntry | null>(null);

  const {
    data: registry,
    isLoading: registryLoading,
    refetch,
  } = usePluginRegistry(DEFAULT_REGISTRY_URL);
  const { data: installedPlugins } = useInstalledPlugins();
  const installMutation = useInstallPlugin();

  const installedIds = useMemo(
    () => new Set(installedPlugins?.map((p) => p.id) ?? []),
    [installedPlugins],
  );

  const { installInProgress } = useAppStore(
    useShallow((s) => ({
      installInProgress: s.plugins.installInProgress,
    })),
  );

  const filteredPlugins = useMemo(() => {
    if (!registry?.plugins) return [];
    return registry.plugins.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter)
        return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [registry?.plugins, searchQuery, categoryFilter]);

  const handleInstall = (plugin: RegistryEntry) => {
    setReviewPlugin(plugin);
  };

  const handleConfirmInstall = () => {
    if (!reviewPlugin) return;
    installMutation.mutate(
      { registryUrl: DEFAULT_REGISTRY_URL, pluginId: reviewPlugin.id },
      { onSettled: () => setReviewPlugin(null) },
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-4">
      {/* Search & filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw
            className={`h-4 w-4 ${registryLoading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.map((cat) => (
          <Badge
            key={cat}
            variant={categoryFilter === cat ? "default" : "outline"}
            className="cursor-pointer capitalize"
            onClick={() => setCategoryFilter(cat)}
          >
            {cat}
          </Badge>
        ))}
      </div>

      {/* Plugin grid */}
      {registryLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading registry...
          </span>
        </div>
      ) : filteredPlugins.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {registry?.plugins
            ? "No plugins match your search"
            : "Unable to load plugin registry"}
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredPlugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                isInstalled={installedIds.has(plugin.id)}
                isInstalling={installInProgress.includes(plugin.id)}
                onSelect={() => setSelectedPlugin(plugin.id)}
                onInstall={() => handleInstall(plugin)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      <PluginPermissionReview
        open={!!reviewPlugin}
        onOpenChange={(open) => !open && setReviewPlugin(null)}
        plugin={reviewPlugin}
        onConfirm={handleConfirmInstall}
        isInstalling={installMutation.isPending}
      />
    </div>
  );
}
