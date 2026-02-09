"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Download, Trash2, Loader2 } from "lucide-react";
import type { InstalledPluginResponse } from "@/services/tauriBackendService";
import type { RegistryEntry } from "@/store/slices/pluginSlice";

interface PluginCardProps {
  plugin: InstalledPluginResponse | RegistryEntry;
  isInstalled: boolean;
  isInstalling: boolean;
  onSelect: () => void;
  onInstall?: () => void;
  onUninstall?: () => void;
}

const categoryColors: Record<string, string> = {
  analysis: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  preprocessing:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  visualization:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  export:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export function PluginCard({
  plugin,
  isInstalled,
  isInstalling,
  onSelect,
  onInstall,
  onUninstall,
}: PluginCardProps) {
  const colorClass =
    categoryColors[plugin.category] ??
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm truncate">{plugin.name}</CardTitle>
            <CardDescription className="text-xs">
              {"author" in plugin && plugin.author
                ? plugin.author
                : "Unknown author"}{" "}
              &middot; v{plugin.version}
            </CardDescription>
          </div>
          <Badge
            variant="secondary"
            className={`text-xs shrink-0 ${colorClass}`}
          >
            {plugin.category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {plugin.description ?? "No description available"}
        </p>
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {plugin.permissions.map((p) => (
            <Badge
              key={p}
              variant="outline"
              className="text-[10px] px-1.5 py-0"
            >
              {p}
            </Badge>
          ))}
        </div>
        <div className="flex justify-end">
          {isInstalled ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall?.();
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Uninstall
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={isInstalling}
              onClick={(e) => {
                e.stopPropagation();
                onInstall?.();
              }}
            >
              {isInstalling ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              {isInstalling ? "Installing..." : "Install"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
