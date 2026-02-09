"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  ShieldAlert,
  Eye,
  FileOutput,
  FileText,
} from "lucide-react";
import type { RegistryEntry } from "@/store/slices/pluginSlice";

interface PluginPermissionReviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: RegistryEntry | null;
  onConfirm: () => void;
  isInstalling: boolean;
}

const permissionInfo: Record<
  string,
  {
    label: string;
    description: string;
    icon: typeof Eye;
    level: "safe" | "caution";
  }
> = {
  ReadChannelData: {
    label: "Read Channel Data",
    description: "Access loaded EEG/MEG channel data for analysis",
    icon: Eye,
    level: "safe",
  },
  WriteResults: {
    label: "Write Results",
    description: "Produce output results from the analysis",
    icon: FileOutput,
    level: "safe",
  },
  ReadMetadata: {
    label: "Read File Metadata",
    description: "Access file metadata (patient info, recording date, etc.)",
    icon: FileText,
    level: "caution",
  },
};

export function PluginPermissionReview({
  open,
  onOpenChange,
  plugin,
  onConfirm,
  isInstalling,
}: PluginPermissionReviewProps) {
  if (!plugin) return null;

  const hasCaution = plugin.permissions.some(
    (p) => permissionInfo[p]?.level === "caution",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasCaution ? (
              <ShieldAlert className="h-5 w-5 text-yellow-500" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            )}
            Review Permissions
          </DialogTitle>
          <DialogDescription>
            <strong>{plugin.name}</strong> by {plugin.author} requests the
            following permissions:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {plugin.permissions.map((perm) => {
            const info = permissionInfo[perm];
            if (!info) {
              return (
                <div
                  key={perm}
                  className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
                >
                  <ShieldAlert className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{perm}</p>
                    <p className="text-xs text-muted-foreground">
                      Unknown permission
                    </p>
                  </div>
                </div>
              );
            }
            const Icon = info.icon;
            return (
              <div
                key={perm}
                className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
              >
                <Icon
                  className={`h-4 w-4 mt-0.5 shrink-0 ${
                    info.level === "caution"
                      ? "text-yellow-500"
                      : "text-green-500"
                  }`}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{info.label}</p>
                    {info.level === "caution" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0 text-yellow-600 border-yellow-300"
                      >
                        caution
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {info.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
          Plugins run in a sandboxed WASM environment and can only access data
          you explicitly allow. They cannot access your filesystem, network, or
          other applications.
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isInstalling}>
            {isInstalling ? "Installing..." : "Install Plugin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
