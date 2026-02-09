"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Puzzle,
  Trash2,
  Play,
  Calendar,
  User,
  Shield,
  FileCode,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  useInstalledPlugin,
  useTogglePlugin,
  useUninstallPlugin,
} from "@/hooks/usePlugins";
import type { InstalledPluginResponse } from "@/services/tauriBackendService";

interface PluginDetailViewProps {
  pluginId: string;
  onRunPlugin: (pluginId: string) => void;
}

export function PluginDetailView({
  pluginId,
  onRunPlugin,
}: PluginDetailViewProps) {
  const { data: plugin } = useInstalledPlugin(pluginId);
  const toggleMutation = useTogglePlugin();
  const uninstallMutation = useUninstallPlugin();

  if (!plugin) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select a plugin to view details
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Puzzle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">{plugin.name}</h3>
            <p className="text-sm text-muted-foreground">
              v{plugin.version} &middot; {plugin.source}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Enabled</span>
          <Switch
            checked={plugin.enabled}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ pluginId: plugin.id, enabled: checked })
            }
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {plugin.description ?? "No description available"}
      </p>

      <Separator />

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {plugin.author && (
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Author:</span>
            <span>{plugin.author}</span>
          </div>
        )}
        {plugin.license && (
          <div className="flex items-center gap-2">
            <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">License:</span>
            <span>{plugin.license}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Installed:</span>
          <span>{new Date(plugin.installedAt).toLocaleDateString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Category:</span>
          <Badge variant="secondary" className="text-xs">
            {plugin.category}
          </Badge>
        </div>
      </div>

      <Separator />

      {/* Permissions */}
      <div>
        <h4 className="text-sm font-medium mb-2">Permissions</h4>
        <div className="flex flex-wrap gap-1.5">
          {plugin.permissions.map((p) => (
            <Badge key={p} variant="outline" className="text-xs">
              {p}
            </Badge>
          ))}
        </div>
      </div>

      <div className="text-xs text-muted-foreground font-mono break-all">
        SHA-256: {plugin.wasmHash}
      </div>

      <Separator />

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={() => onRunPlugin(plugin.id)}
          disabled={!plugin.enabled}
        >
          <Play className="h-4 w-4 mr-2" />
          Run on Current Analysis
        </Button>
        <Button
          variant="destructive"
          onClick={() => uninstallMutation.mutate(plugin.id)}
          disabled={uninstallMutation.isPending}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Uninstall
        </Button>
      </div>
    </div>
  );
}
